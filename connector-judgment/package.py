"""Build a local Judgment candidate from an inspected 1.2.0 plugin snapshot.

No account writes. Preserve unrelated files and the default prompt. Reconcile the
actual current account release before any later guarded publication.
"""
import argparse
import hashlib
import json
from pathlib import Path
import posixpath
import re
import subprocess
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build(base, output):
    repo = Path(__file__).resolve().parents[1]
    output = output.resolve()
    if any(p.exists() for p in [output, output.with_suffix('.validation.json'), output.with_suffix('.tests.tap')]):
        raise ValueError('Output exists; preserve earlier candidate/evidence.')
    files = {}
    for path in base.resolve().rglob('*'):
        if path.is_symlink():
            raise ValueError('Base contains a symlink.')
        if path.is_file():
            files[path.relative_to(base).as_posix()] = path.read_bytes()
    manifest = json.loads(files['plugin.json'])
    compatibility = json.loads(files['.codex-plugin/plugin.json'])
    if manifest['name'] != 'nmsu-hive-mind' or manifest['version'] != '1.2.0' or compatibility['version'] != '1.2.0':
        raise ValueError('Expected inspected nmsu-hive-mind 1.2.0 base; reconcile changed releases.')
    baseline = json.loads((repo / 'connector-judgment/base-skills.json').read_text())
    if set(p for p in files if p.startswith('skills/')) != set(baseline):
        raise ValueError('Base skill inventory changed; inspect current account source.')
    for key, expected in baseline.items():
        if digest(files[key]) != expected:
            raise ValueError(f'Base skill bytes changed: {key}')
    original = dict(files)
    for component in ['executor', 'enforcer', 'feedback', 'judgment']:
        root = repo / f'connector-{component}/skills'
        for path in root.rglob('*'):
            if path.is_symlink():
                raise ValueError('Source contains a symlink.')
            if path.is_file():
                files['skills/' + path.relative_to(root).as_posix()] = path.read_bytes()
    if len([p for p in files if p.endswith('/SKILL.md')]) != 4:
        raise ValueError('Expected exactly four Hive Mind skills.')
    for key, data in files.items():
        if key.startswith('skills/') and key.endswith('.md'):
            for link in re.findall(r'\]\(([^)]+)\)', data.decode()):
                if '://' in link or link.startswith('#'):
                    continue
                target = posixpath.normpath(posixpath.join(posixpath.dirname(key), link.split('#')[0]))
                if target not in files:
                    raise ValueError(f'Missing reference {target} from {key}')
    suites = sorted(repo.glob('connector-*/*.test.mjs'))
    run = subprocess.run(['node', '--test', '--test-reporter=tap', *map(str, suites)], cwd=repo, capture_output=True, text=True)
    match = re.search(r'^# tests (\d+)$', run.stdout, re.M)
    if run.returncode or not match or not re.search(r'^# fail 0$', run.stdout, re.M):
        raise RuntimeError(run.stdout + run.stderr)
    version = '1.3.0'
    description = 'Four Hive Mind skills for drafting, independent review, same-Doc feedback, scoped decisions and human-confirmed learning through existing Google connections.'
    manifest.update(version=version, description=description)
    interface = manifest['extensions']['com.openai']['interface']
    old_prompt = interface['defaultPrompt']
    interface['shortDescription'] = 'Draft, review and learn'
    interface['longDescription'] = description + ' Work proposes useful lessons; each board’s designated human confirms exact wording and scope. Sheets is persistent memory. No automatic business-task completion.'
    if len(interface['shortDescription']) > 30:
        raise ValueError('Subtitle exceeds 30 characters.')
    compatibility.update(version=version, description=description)
    compatibility['interface'].update(interface)
    if compatibility['interface']['defaultPrompt'] != old_prompt:
        raise ValueError('Default prompt changed.')
    files['plugin.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    files['.codex-plugin/plugin.json'] = (json.dumps(compatibility, indent=2) + '\n').encode()
    changed = {p: digest(b) for p, b in files.items() if original.get(p) != b}
    preserved = {p: digest(b) for p, b in files.items() if original.get(p) == b}
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for key, data in sorted(files.items()):
            archive.writestr(key, data)
    with zipfile.ZipFile(output) as archive:
        if set(archive.namelist()) != set(files) or any(archive.read(p) != b for p, b in files.items()):
            raise ValueError('Archive verification failed.')
    report = {
        'status': 'candidate_packaged_not_published', 'base_version': '1.2.0',
        'candidate_version': version, 'test_count': int(match.group(1)), 'test_failures': 0,
        'test_files': [p.relative_to(repo).as_posix() for p in suites],
        'changed_or_added_sha256': changed, 'preserved_sha256': preserved,
        'default_prompt_preserved': True, 'archive_sha256': digest(output.read_bytes()),
        'account_release_verified': False,
        'limits': ['Synthetic local tests, not hosted Work certification.',
                   'New Judgment Log, human confirmation and participant connectors need disposable acceptance.',
                   'Reconcile current account source/release before guarded update.',
                   'No live board/configuration migration or workflow execution is implied.'],
    }
    output.with_suffix('.validation.json').write_text(json.dumps(report, indent=2) + '\n')
    output.with_suffix('.tests.tap').write_text(run.stdout)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-plugin', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.base_plugin, args.output), indent=2))
