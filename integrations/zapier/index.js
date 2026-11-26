const { version: platformVersion } = require("zapier-platform-core");
const { version } = require("./package.json");
const authentication = require("./authentication");
const { addKey, checkErrors } = require("./lib");
const triggers = require("./triggers");
const employee = require("./creates/employee");

module.exports = {
  version,
  platformVersion,
  authentication,
  beforeRequest: [addKey],
  afterResponse: [checkErrors],
  triggers: Object.fromEntries(triggers.map((t) => [t.key, t])),
  creates: { [employee.key]: employee },
};
