// Saralix API keys look like sx_<id>.<secret>. Create one under Settings → API & webhooks with
// the scopes employees:read, employees:write and webhooks:manage.
module.exports = {
  type: "custom",
  fields: [
    { key: "apiKey", label: "API key", required: true, type: "password", helpText: "In Saralix, open Settings → API & webhooks, create a key for Zapier, and tick **Employees and their jobs**, **Add employees** and **Subscribe to events**. Paste it here." },
    { key: "site", label: "Saralix address", required: false, default: "https://app.saralix.com", helpText: "Leave as it is unless your company uses another Saralix site." },
  ],
  test: { url: "{{bundle.authData.site}}/api/v1/me" },
  connectionLabel: "{{json.company.name}}",
};
