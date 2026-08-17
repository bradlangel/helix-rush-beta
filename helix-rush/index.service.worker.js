'use strict';

const LEGACY_CACHE_PREFIX = 'Helix Rush-sw-cache-';
const CANONICAL_URL = 'https://bradlangel.github.io/upcoil/';
const REDIRECT_HTML = `<!doctype html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="robots" content="noindex,nofollow,noarchive">
	<title>Helix Rush is now Upcoil</title>
</head>
<body>
	<p>Helix Rush is now <a href="${CANONICAL_URL}">Upcoil</a>.</p>
	<script>
		const target = new URL('${CANONICAL_URL}');
		target.search = window.location.search;
		target.hash = window.location.hash;
		window.location.replace(target.href);
	<\/script>
</body>
</html>`;

async function deleteLegacyCaches() {
	const keys = await caches.keys();
	await Promise.all(keys.filter(function (key) {
		return key.startsWith(LEGACY_CACHE_PREFIX);
	}).map(function (key) {
		return caches.delete(key);
	}));
}

function legacyScopeClients() {
	const scope = new URL(self.registration.scope);
	return self.clients.matchAll({
		type: 'window',
		includeUncontrolled: true,
	}).then(function (clients) {
		return clients.filter(function (client) {
			const url = new URL(client.url);
			return url.origin === scope.origin && url.pathname.startsWith(scope.pathname);
		});
	});
}

self.addEventListener('install', function (event) {
	// Clear a cached game shell before this replacement worker takes control.
	event.waitUntil(deleteLegacyCaches().then(function () {
		return self.skipWaiting();
	}));
});

self.addEventListener('activate', function (event) {
	event.waitUntil((async function () {
		await deleteLegacyCaches();
		await self.clients.claim();
		const clients = await legacyScopeClients();
		await self.registration.unregister();
		await Promise.all(clients.map(function (client) {
			const source = new URL(client.url);
			const target = new URL(CANONICAL_URL);
			target.search = source.search;
			target.hash = source.hash;
			return client.navigate(target.href);
		}));
	}()));
});

self.addEventListener('fetch', function (event) {
	if (event.request.mode !== 'navigate') return;
	event.respondWith(Promise.resolve(new Response(REDIRECT_HTML, {
		status: 200,
		headers: {
			'Cache-Control': 'no-store',
			'Content-Type': 'text/html; charset=utf-8',
		},
	})));
});
