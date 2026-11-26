const base = (bundle) => `${(bundle.authData.site || "https://app.saralix.com").replace(/\/+$/, "")}/api/v1`;

/** Sends the API key on every request, and turns Saralix errors into messages Zapier shows. */
const addKey = (request, z, bundle) => {
  if (bundle.authData.apiKey) request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`;
  return request;
};
const checkErrors = (response, z) => {
  if (response.status >= 400) {
    let message = `Saralix returned ${response.status}`;
    try {
      message = response.json?.error?.message ?? message;
    } catch (e) {
      /* not JSON */
    }
    if (response.status === 401) throw new z.errors.RefreshAuthError(message);
    throw new z.errors.Error(message, response.status === 403 ? "forbidden" : "api_error", response.status);
  }
  return response;
};

/**
 * A REST hook trigger for one Saralix event: Zapier subscribes when a zap is turned on and
 * unsubscribes when it's turned off. The sample comes from recent events in the account.
 */
const hookTrigger = ({ event, noun, label, description, sample }) => ({
  key: event.replace(".", "_"),
  noun,
  display: { label, description },
  operation: {
    type: "hook",
    performSubscribe: async (z, bundle) => (await z.request({ url: `${base(bundle)}/hooks`, method: "POST", body: { url: bundle.targetUrl, event } })).json,
    performUnsubscribe: async (z, bundle) => (await z.request({ url: `${base(bundle)}/hooks/${bundle.subscribeData.id}`, method: "DELETE" })).json,
    perform: (z, bundle) => [{ id: bundle.cleanedRequest.id ?? `${event}-${Date.now()}`, ...bundle.cleanedRequest }],
    performList: async (z, bundle) => (await z.request({ url: `${base(bundle)}/events/${event}/samples` })).json,
    sample,
  },
});

module.exports = { base, addKey, checkErrors, hookTrigger };
