// This service worker is required to expose an exported Godot project as a
// Progressive Web App. It provides an offline fallback page telling the user
// that they need an Internet connection to run the project if desired.
// Incrementing CACHE_VERSION will kick off the install event and force
// previously cached resources to be updated from the network.
/** @type {string} */
const CACHE_VERSION = '1786725964|3041905';
const HELIX_RUSH_BUILD_ID = '5bb59a8dfebc-run31820766890.1';
/** @type {string} */
const CACHE_PREFIX = 'Helix Rush-sw-cache-';
const CACHE_NAME = CACHE_PREFIX + CACHE_VERSION + '-' + HELIX_RUSH_BUILD_ID;
/** @type {string} */
const OFFLINE_URL = 'index.offline.html';
const NAVIGATION_CACHE_URL = 'index.html';
/** @type {boolean} */
const ENSURE_CROSSORIGIN_ISOLATION_HEADERS = false;
// Files that will be cached on load.
/** @type {string[]} */
const CACHED_FILES = ["release.json","GODOT_COPYRIGHT.txt","index.html","index.js","index.offline.html","index.audio.worklet.js","index.audio.position.worklet.js"];
// Files that we might not want the user to preload, and will only be cached on first load.
/** @type {string[]} */
const CACHEABLE_FILES = ["index.wasm","index.pck"];
const FULL_CACHE = CACHED_FILES.concat(CACHEABLE_FILES);

self.addEventListener('install', (event) => {
	// Activate a newly stamped release without waiting for old game tabs to close.
	event.waitUntil(
		caches.open(CACHE_NAME)
			.then((cache) => cache.addAll(CACHED_FILES))
			.then(() => self.skipWaiting())
	);
});

const HELIX_RUSH_RELEASE_READY_CLIENTS = new Set();
const HELIX_RUSH_RELEASE_RETRY_DELAYS_MS = [0, 750, 1500, 3000];

self.addEventListener('message', (event) => {
	const data = event.data || {};
	if (
		data.type === 'HELIX_RUSH_RELEASE_READY'
		&& data.build_id === HELIX_RUSH_BUILD_ID
		&& event.source
		&& event.source.id
	) {
		HELIX_RUSH_RELEASE_READY_CLIENTS.add(event.source.id);
	}
});

function navigateHelixRushReleaseClients() {
	return self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(
		(all) => all.forEach((client) => {
			if (HELIX_RUSH_RELEASE_READY_CLIENTS.has(client.id)) return null;
			// Initiate the authoritative navigation without making activation wait
			// for a navigation that may itself wait for activation to finish.
			client.navigate(client.url).catch(() => {
				client.postMessage({
					type: 'HELIX_RUSH_RELEASE_UPDATED',
					build_id: HELIX_RUSH_BUILD_ID,
				});
			});
		})
	);
}

function notifyHelixRushReleaseClients() {
	return self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(
		(all) => all.forEach((client) => {
			if (HELIX_RUSH_RELEASE_READY_CLIENTS.has(client.id)) return;
			client.postMessage({
				type: 'HELIX_RUSH_RELEASE_UPDATED',
				build_id: HELIX_RUSH_BUILD_ID,
			});
		})
	);
}

function retryHelixRushReleaseNotification(attempt = 0) {
	if (attempt >= HELIX_RUSH_RELEASE_RETRY_DELAYS_MS.length) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		setTimeout(resolve, HELIX_RUSH_RELEASE_RETRY_DELAYS_MS[attempt]);
	}).then(() => notifyHelixRushReleaseClients())
		.then(() => retryHelixRushReleaseNotification(attempt + 1));
}

self.addEventListener('activate', (event) => {
	let replacingRelease = false;
	event.waitUntil(caches.keys().then(
		function (keys) {
			// Remove old caches before claiming tabs and navigating them to the
			// newly stamped release.
			replacingRelease = keys.some((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME);
			return Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
		}
	).then(function () {
		// Enable navigation preload if available.
		return ('navigationPreload' in self.registration) ? self.registration.navigationPreload.enable() : Promise.resolve();
	}).then(function () {
		// Refresh open game tabs after replacing an older cached release.
		return self.clients.claim();
	}).then(function () {
		if (!replacingRelease) {
			return Promise.resolve();
		}
		// Navigate once, then retry a build-aware refresh notification for slow
		// or already-reloading tabs. A page that acknowledges this build is done.
		return navigateHelixRushReleaseClients()
			.then(() => retryHelixRushReleaseNotification());
	}));
});

/**
 * Ensures that the response has the correct COEP/COOP headers
 * @param {Response} response
 * @returns {Response}
 */
function ensureCrossOriginIsolationHeaders(response) {
	if (response.headers.get('Cross-Origin-Embedder-Policy') === 'require-corp'
		&& response.headers.get('Cross-Origin-Opener-Policy') === 'same-origin') {
		return response;
	}

	const crossOriginIsolatedHeaders = new Headers(response.headers);
	crossOriginIsolatedHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
	crossOriginIsolatedHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
	const newResponse = new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers: crossOriginIsolatedHeaders,
	});

	return newResponse;
}

/**
 * Calls fetch and cache the result if it is cacheable
 * @param {FetchEvent} event
 * @param {Cache} cache
 * @param {boolean} isCacheable
 * @returns {Response}
 */
async function fetchAndCache(event, cache, isCacheable) {
	// Use the preloaded response, if it's there
	/** @type { Response } */
	let response = await event.preloadResponse;
	if (response == null) {
		// Or, go over network.
		response = await self.fetch(event.request);
	}

	if (ENSURE_CROSSORIGIN_ISOLATION_HEADERS) {
		response = ensureCrossOriginIsolationHeaders(response);
	}

	if (isCacheable) {
		// And update the cache
		cache.put(event.request, response.clone());
	}

	return response;
}

self.addEventListener(
	'fetch',
	/**
	 * Triggered on fetch
	 * @param {FetchEvent} event
	 */
	(event) => {
		const isNavigate = event.request.mode === 'navigate';
		const url = event.request.url || '';
		const referrer = event.request.referrer || '';
		const base = referrer.slice(0, referrer.lastIndexOf('/') + 1);
		const local = url.startsWith(base) ? url.replace(base, '') : '';
		const isCacheable = FULL_CACHE.some((v) => v === local) || (base === referrer && base.endsWith(CACHED_FILES[0]));
		if (isNavigate || isCacheable) {
			event.respondWith((async () => {
				// Try to use cache first
				const cache = await caches.open(CACHE_NAME);
				if (isNavigate) {
					// Check if we have full cache during HTML page request.
					/** @type {Response[]} */
					const fullCache = await Promise.all(FULL_CACHE.map((name) => cache.match(name)));
					const missing = fullCache.some((v) => v === undefined);
					if (missing) {
						try {
							// Try network if some cached file is missing (so we can display offline page in case).
							const response = await fetchAndCache(event, cache, isCacheable);
							return response;
						} catch (e) {
							// And return the hopefully always cached offline page in case of network failure.
							console.error('Network error: ', e); // eslint-disable-line no-console
							return caches.match(OFFLINE_URL);
						}
					}
				}
				const requestURL = new URL(event.request.url);
				const scopeURL = new URL(self.registration.scope);
				const isScopeRootNavigation = isNavigate
					&& requestURL.origin === scopeURL.origin
					&& requestURL.pathname === scopeURL.pathname;
				let cached = await cache.match(isScopeRootNavigation ? NAVIGATION_CACHE_URL : event.request);
				if (cached != null) {
					if (ENSURE_CROSSORIGIN_ISOLATION_HEADERS) {
						cached = ensureCrossOriginIsolationHeaders(cached);
					}
					return cached;
				}
				// Try network if don't have it in cache.
				const response = await fetchAndCache(event, cache, isCacheable);
				return response;
			})());
		} else if (ENSURE_CROSSORIGIN_ISOLATION_HEADERS) {
			event.respondWith((async () => {
				let response = await fetch(event.request);
				response = ensureCrossOriginIsolationHeaders(response);
				return response;
			})());
		}
	}
);

self.addEventListener('message', (event) => {
	// No cross origin
	if (event.origin !== self.origin) {
		return;
	}
	const id = event.source.id || '';
	const msg = event.data || '';
	// Ensure it's one of our clients.
	self.clients.get(id).then(function (client) {
		if (!client) {
			return; // Not a valid client.
		}
		if (msg === 'claim') {
			self.skipWaiting().then(() => self.clients.claim());
		} else if (msg === 'clear') {
			caches.delete(CACHE_NAME);
		} else if (msg === 'update') {
			self.skipWaiting().then(() => self.clients.claim()).then(() => self.clients.matchAll()).then((all) => all.forEach((c) => c.navigate(c.url)));
		}
	});
});

