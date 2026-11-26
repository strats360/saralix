const { base } = require("../lib");

module.exports = {
  key: "employee",
  noun: "Employee",
  display: { label: "Add Employee", description: "Adds an employee and, if you like, emails them a link to fill in their own details." },
  operation: {
    inputFields: [
      { key: "firstName", label: "First name", required: true },
      { key: "lastName", label: "Last name" },
      { key: "workEmail", label: "Work email", required: true },
      { key: "dateOfJoining", label: "Date of joining", type: "datetime", required: true, helpText: "Only the date is used." },
      { key: "mobile", label: "Mobile" },
      { key: "employeeCode", label: "Employee code", helpText: "Leave blank and Saralix gives the next one." },
      { key: "department", label: "Department", helpText: "The name of a department that exists in Saralix, like Engineering." },
      { key: "designation", label: "Designation", helpText: "The name of a designation that exists in Saralix." },
      { key: "sendInvite", label: "Send them the onboarding email?", type: "boolean", default: "yes" },
    ],
    perform: async (z, bundle) => {
      const d = bundle.inputData;
      const body = {
        firstName: d.firstName,
        lastName: d.lastName || "",
        workEmail: d.workEmail,
        dateOfJoining: String(d.dateOfJoining).slice(0, 10),
        mobile: d.mobile || null,
        employeeCode: d.employeeCode || null,
        department: d.department || null,
        designation: d.designation || null,
        sendInvite: d.sendInvite === undefined ? true : d.sendInvite === true || d.sendInvite === "true" || d.sendInvite === "yes",
      };
      return (await z.request({ url: `${base(bundle)}/employees`, method: "POST", body })).json;
    },
    sample: { id: "8f3c1d2e-0000-4000-8000-000000000001", employeeCode: "STL-0251", fullName: "Asha Patel", workEmail: "asha.patel@example.com", status: "onboarding", invited: true },
  },
};
