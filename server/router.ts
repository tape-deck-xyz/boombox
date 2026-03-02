/** @file Custom router implementation for Deno server */

export interface Route {
  pattern: string;
  handler: (req: Request, params: Record<string, string>) => Promise<Response>;
  method?: string;
}

/**
 * Match a route pattern against a pathname
 * Supports :param syntax for dynamic segments
 */
function matchRoute(
  pattern: string,
  pathname: string,
): { match: boolean; params: Record<string, string> } {
  const params: Record<string, string> = {};
  const patternParts = pattern.split("/").filter(Boolean);
  // URL pathname is already decoded, but we need to handle URL-encoded segments
  // Split and decode each part individually
  const pathParts = pathname
    .split("/")
    .filter(Boolean)
    .map((part) => {
      try {
        // Try to decode - if already decoded, this will just return the same string
        return decodeURIComponent(part);
      } catch {
        // If decoding fails, return as-is
        return part;
      }
    });

  if (patternParts.length !== pathParts.length) {
    return { match: false, params: {} };
  }

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const pathPart = pathParts[i];

    if (patternPart.startsWith(":")) {
      // Dynamic segment - pathPart is already decoded above
      const paramName = patternPart.slice(1);
      params[paramName] = pathPart;
    } else if (patternPart !== pathPart) {
      // Static segment doesn't match
      return { match: false, params: {} };
    }
  }

  return { match: true, params };
}

/**
 * Register routes and handle incoming requests
 */
export class Router {
  private routes: Route[] = [];

  /**
   * Register a route
   */
  add(route: Route): void {
    this.routes.push(route);
  }

  /**
   * Handle a request by matching it against registered routes
   */
  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    // Sort routes by specificity (static routes first, then dynamic)
    const sortedRoutes = [...this.routes].sort((a, b) => {
      const aHasParams = a.pattern.includes(":");
      const bHasParams = b.pattern.includes(":");
      if (aHasParams && !bHasParams) return 1;
      if (!aHasParams && bHasParams) return -1;
      return 0;
    });

    for (const route of sortedRoutes) {
      // Check method if specified
      if (route.method && req.method !== route.method) {
        continue;
      }

      const { match, params } = matchRoute(route.pattern, pathname);
      if (match) {
        try {
          return await route.handler(req, params);
        } catch (error) {
          console.error("Route handler error:", error);
          const errorMessage = error instanceof Error
            ? error.message
            : "Unknown error";
          const errorStack = error instanceof Error ? error.stack : undefined;
          console.error("Error stack:", errorStack);
          return new Response(`Internal Server Error: ${errorMessage}`, {
            status: 500,
            headers: { "Content-Type": "text/plain" },
          });
        }
      }
    }

    // No route matched
    return new Response("Not Found", { status: 404 });
  }
}
