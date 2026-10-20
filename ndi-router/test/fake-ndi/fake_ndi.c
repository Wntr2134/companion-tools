// A stand-in for the NDI runtime with the same function signatures as Processing.NDI.Lib.h,
// so the koffi bindings can be tested without NDI installed. Build: see test/ndi.test.mjs.
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef struct { const char *p_ndi_name; const char *p_url_address; } NDIlib_source_t;
typedef struct { bool show_local_sources; const char *p_groups; const char *p_extra_ips; } NDIlib_find_create_t;
typedef struct { const char *p_ndi_name; const char *p_groups; } NDIlib_routing_create_t;

static NDIlib_source_t sources[32];
static uint32_t n_sources = 0;
static char *names[32];

typedef struct { char name[256]; char target[256]; int connections; } route_t;
static route_t routes[16];
static int n_routes = 0;
static int initialised = 0;

bool NDIlib_initialize(void) { initialised = 1; return true; }
void NDIlib_destroy(void) { initialised = 0; }
const char *NDIlib_version(void) { return "FAKE NDI 6.2"; }

void *NDIlib_find_create_v2(const NDIlib_find_create_t *s) { (void)s; return (void *)0x1234; }
void NDIlib_find_destroy(void *p) { (void)p; }
bool NDIlib_find_wait_for_sources(void *p, uint32_t t) { (void)p; (void)t; return true; }
const NDIlib_source_t *NDIlib_find_get_current_sources(void *p, uint32_t *count) {
	(void)p;
	*count = n_sources;
	return n_sources ? sources : NULL;
}

void *NDIlib_routing_create(const NDIlib_routing_create_t *s) {
	if (!initialised || n_routes >= 16 || !s || !s->p_ndi_name) return NULL;
	route_t *r = &routes[n_routes++];
	strncpy(r->name, s->p_ndi_name, 255);
	r->target[0] = 0;
	r->connections = 0;
	return r;
}
void NDIlib_routing_destroy(void *p) { route_t *r = p; r->name[0] = 0; }
bool NDIlib_routing_change(void *p, const NDIlib_source_t *src) {
	route_t *r = p;
	if (!src || !src->p_ndi_name) return false;
	strncpy(r->target, src->p_ndi_name, 255);
	return true;
}
bool NDIlib_routing_clear(void *p) { ((route_t *)p)->target[0] = 0; return true; }
int NDIlib_routing_get_no_connections(void *p, uint32_t t) { (void)t; return ((route_t *)p)->connections; }

// ---- test helpers (not part of NDI) ----
void fake_set_sources(const char *newline_separated) {
	for (uint32_t i = 0; i < n_sources; i++) free(names[i]);
	n_sources = 0;
	const char *s = newline_separated;
	while (s && *s && n_sources < 32) {
		const char *e = strchr(s, '\n');
		size_t len = e ? (size_t)(e - s) : strlen(s);
		names[n_sources] = strndup(s, len);
		sources[n_sources].p_ndi_name = names[n_sources];
		sources[n_sources].p_url_address = NULL;
		n_sources++;
		s = e ? e + 1 : NULL;
	}
}
const char *fake_route_name(int i) { return i < n_routes ? routes[i].name : ""; }
const char *fake_route_target(int i) { return i < n_routes ? routes[i].target : ""; }
void fake_set_connections(int i, int n) { if (i < n_routes) routes[i].connections = n; }
int fake_route_count(void) { return n_routes; }
void fake_reset_routes(void) { n_routes = 0; }
