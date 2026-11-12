"""Build a review candidate only, after running the entire connector suite.

The supplied base is a locally retrieved plugin snapshot, not proof of the account's
current release. Preserve its existing files and metadata. Publishing requires
current account source/release reconciliation through the existing plugin identity.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def build(base, output):
    repo = Path(__file__).resolve().parents[1]
    base = base.resolve()
    output = output.resolve()
    if output.exists():
        raise ValueError('Output already exists; preserve earlier packages.')
    files = {}
    for path in base.rglob('*'):
        if path.is_symlink():
            raise ValueError('Base contains a symlink.')
        if path.is_file():
            files[path.relative_to(base).as_posix()] = path.read_bytes()
    manifest = json.loads(files['plugin.json'])
    if manifest['name'] != 'nmsu-hive-mind' or manifest['version'] != '1.1.0':
        raise ValueError('Expected inspected nmsu-hive-mind 1.1.0 base; reconcile a changed release first.')
    preserved = {}
    for component in ['executor', 'enforcer']:
        root = repo / f'connector-{component}' / 'skills'
        for path in root.rglob('*'):
            if not path.is_file():
                continue
            key = 'skills/' + path.relative_to(root).as_posix()
            if files.get(key) != path.read_bytes():
                raise ValueError(f'Existing skill differs from inspected base: {key}')
            preserved[key] = digest(files[key])
    root = repo / 'connector-feedback' / 'skills'
    added = {}
    for path in root.rglob('*'):
        if not path.is_file():
            continue
        key = 'skills/' + path.relative_to(root).as_posix()
        if key in files:
            raise ValueError(f'Feedback path already exists in base: {key}')
        files[key] = path.read_bytes()
        added[key] = digest(files[key])
    if len([p for p in files if p.endswith('/SKILL.md')]) != 3:
        raise ValueError('Expected exactly Executor, Enforcer and Feedback skills.')
    for key in added:
        if key.endswith('.md'):
            for link in re.findall(r'\]\(([^)]+)\)', files[key].decode()):
                if '://' in link or link.startswith('#'):
                    continue
                target = (Path(key).parent / link).as_posix()
                if target not in files:
                    raise ValueError(f'Missing packaged reference: {target}')
    # Tests execute before any candidate archive is written.
    suites = sorted(repo.glob('connector-*/*.test.mjs'))
    run = subprocess.run(['node', '--test', '--test-reporter=tap', *map(str, suites)], cwd=repo, capture_output=True, text=True)
    if run.returncode:
        raise RuntimeError(run.stdout + run.stderr)
    match = re.search(r'^# tests (\d+)$', run.stdout, re.M)
    if not match or not re.search(r'^# fail 0$', run.stdout, re.M):
        raise ValueError('Missing test completion evidence.')
    version = '1.2.0'
    description = manifest['description'] + ' Feedback directly revises the same Doc from authorized human comments and replies in their original threads.'
    manifest['version'] = version
    manifest['description'] = description
    interface = manifest['extensions']['com.openai']['interface']
    interface['shortDescription'] = 'Draft, review and revise'
    interface['longDescription'] += ' Feedback makes authorized direct edits in the same document, explains them in the originating human thread and reconstructs partial effects from Sheets. Learning and task completion remain separate.'
    if len(interface['shortDescription']) > 30:
        raise ValueError('Listing subtitle exceeds 30 characters.')
    files['plugin.json'] = (json.dumps(manifest, indent=2) + '\n').encode()
    compatibility = json.loads(files['.codex-plugin/plugin.json'])
    compatibility.update(version=version, description=description)
    # Preserve compatibility-only developerName/capabilities and defaultPrompt.
    compatibility['interface'].update({k: v for k, v in interface.items()})
    files['.codex-plugin/plugin.json'] = (json.dumps(compatibility, indent=2) + '\n').encode()
    base_prompt = json.loads((base / 'plugin.json').read_text())['extensions']['com.openai']['interface']['defaultPrompt']
    if interface['defaultPrompt'] != base_prompt or compatibility['interface']['defaultPrompt'] != base_prompt:
        raise ValueError('Default prompt changed.')
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for key, data in sorted(files.items()):
            archive.writestr(key, data)
    with zipfile.ZipFile(output) as archive:
        if sorted(archive.namelist()) != sorted(files):
            raise ValueError('Archive inventory mismatch.')
        for key, data in files.items():
            if archive.read(key) != data:
                raise ValueError(f'Archive bytes mismatch: {key}')
    report = {
        'status': 'candidate_packaged_not_published', 'base_name': manifest['name'],
        'base_version': '1.1.0', 'candidate_version': version,
        'test_count': int(match.group(1)), 'test_failures': 0,
        'test_files': [p.relative_to(repo).as_posix() for p in suites],
        'preserved_skill_sha256': preserved, 'added_skill_sha256': added,
        'default_prompt_preserved': True, 'archive': str(output),
        'archive_sha256': digest(output.read_bytes()), 'archive_files': sorted(files),
        'account_release_verified': False,
        'limitations': ['Local failure/recovery tests are not live cloud fault injection.', 'Prior live tests exercised direct edits and native threaded replies, not this installed Feedback skill.', 'Reconcile current account release before publishing; retain existing plugin identity.'],
    }
    report_path = output.with_suffix('.validation.json')
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    output.with_suffix('.tests.tap').write_text(run.stdout)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-plugin', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.base_plugin, args.output), indent=2))
