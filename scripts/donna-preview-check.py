#!/usr/bin/env python3
"""Check a deployed Donna preview without signing in or reading customer records."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]


def run(base_url, commit=None):
    commit = commit or subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Supply the exact 40-character deployed commit SHA.')

    def source(relative):
        return subprocess.check_output(['git', 'show', f'{commit}:{relative}'], cwd=ROOT)

    parsed = urllib.parse.urlsplit(base_url)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or
            parsed.password or parsed.query or parsed.fragment or
            parsed.path.rstrip('/') != '/donna'):
        raise ValueError('Supply an HTTPS preview URL ending in /donna/ with no credentials or query.')
    base_url = base_url.rstrip('/') + '/'
    origin = urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, '', '', ''))
    checks = []

    class SameOriginRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            if urllib.parse.urlsplit(newurl).netloc != parsed.netloc:
                raise ValueError('Preview redirected outside its own host; authenticate or review access separately.')
            return super().redirect_request(req, fp, code, msg, headers, newurl)

    opener = urllib.request.build_opener(SameOriginRedirect())

    def request(url, expected=200, method='GET'):
        req = urllib.request.Request(url, method=method, headers={
            'User-Agent': 'Donna-Preview-Check/1.0', 'Cache-Control': 'no-cache'})
        try:
            response = opener.open(req, timeout=25)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            body = response.read(2_000_001)
            if response.status != expected:
                raise AssertionError(f'{method} {urllib.parse.urlsplit(url).path}: expected {expected}, got {response.status}')
            if len(body) > 2_000_000:
                raise AssertionError('Preview response exceeded the smoke-check size bound.')
            return response.headers, body

    def check(name, condition):
        if not condition:
            raise AssertionError(name)
        checks.append(name)

    headers, body = request(base_url)
    check('Donna document matches checked-out source', body == source('donna/index.html'))
    check('Donna microphone policy allows only this origin', headers.get('Permissions-Policy') == 'camera=(), microphone=(self), geolocation=(), payment=()')
    check('Donna HTML is not cached', 'no-store' in headers.get('Cache-Control', ''))
    policy = headers.get('Content-Security-Policy', '')
    check('Donna CSP restricts scripts and framing', "script-src 'self'" in policy and "frame-ancestors 'none'" in policy)
    check('Donna remains unindexed', 'noindex' in headers.get('X-Robots-Tag', ''))

    files = [('app.js', 'javascript'), ('api.js', 'javascript'), ('core.js', 'javascript'),
             ('style.css', 'text/css'), ('manifest.webmanifest', 'json'), ('icon.svg', 'svg')]
    for filename, content_type in files:
        asset_headers, asset = request(urllib.parse.urljoin(base_url, filename))
        check(f'{filename}: correct content type', content_type in asset_headers.get('Content-Type', ''))
        check(f'{filename}: source integrity', hashlib.sha256(asset).digest() == hashlib.sha256(source('donna/' + filename)).digest())
    manifest = json.loads(request(urllib.parse.urljoin(base_url, 'manifest.webmanifest'))[1])
    check('Home Screen launch opens voice route', manifest.get('start_url') == './?view=voice' and manifest.get('scope') == './')

    dashboard_headers, _ = request(origin + '/')
    check('Existing dashboard keeps microphone denied', dashboard_headers.get('Permissions-Policy') == 'camera=(), microphone=(), geolocation=(), payment=()')
    config_headers, config_body = request(origin + '/config.js')
    check('Public deployment config is unchanged', config_body == source('config.js'))
    for path, method, expected in [('tasks', 'GET', 401), ('status', 'GET', 401),
                                   ('not-a-tool', 'GET', 404), ('tasks', 'POST', 405)]:
        gateway_headers, gateway_body = request(origin + '/api/donna/' + path, expected, method)
        check(f'Gateway {method} {path}: JSON denial', isinstance(json.loads(gateway_body).get('error'), str))
        check(f'Gateway {method} {path}: no private response caching', 'no-store' in gateway_headers.get('Cache-Control', ''))
    return {'result': 'PASS', 'url': base_url, 'sourceCommit': commit, 'checks': len(checks), 'passed': checks,
            'businessRecordsRead': False, 'authenticated': False,
            'limits': 'HTTP/source/header checks only; rendered browser, Siri and iPhone speech remain unverified.'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', required=True, help='Exact HTTPS /donna/ branch preview URL')
    parser.add_argument('--commit', help='Exact deployed commit SHA; defaults to committed HEAD, ignoring working edits')
    args = parser.parse_args()
    print(json.dumps(run(args.url, args.commit), indent=2))
