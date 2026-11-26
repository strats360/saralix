const { hookTrigger } = require("../lib");

const employee = { id: "8f3c1d2e-0000-4000-8000-000000000001", employeeCode: "STL-0251", fullName: "Asha Patel", workEmail: "asha.patel@example.com", status: "onboarding", dateOfJoining: "2026-12-01" };
const run = { id: "run-1", month: "2026-11", periodStart: "2026-11-01", periodEnd: "2026-11-30", payDate: "2026-11-30", totals: { gross: 3512000, deductions: 412000, net: 3100000, employees: 236 } };

module.exports = [
  hookTrigger({ event: "employee.created", noun: "Employee", label: "New Employee", description: "Triggers when an employee is added to Saralix.", sample: employee }),
  hookTrigger({ event: "employee.updated", noun: "Employee", label: "Updated Employee", description: "Triggers when an employee's details change. Sensitive fields like bank details are never sent.", sample: { id: employee.id, employeeCode: employee.employeeCode, fullName: employee.fullName, status: "active", fields: ["designationId", "departmentId"] } }),
  hookTrigger({ event: "employee.exited", noun: "Exit", label: "Employee Exit Completed", description: "Triggers when an employee's exit is completed, so you can switch off their accounts.", sample: { id: employee.id, employeeCode: employee.employeeCode, fullName: employee.fullName, type: "resignation", lastWorkingDay: "2026-12-31" } }),
  hookTrigger({ event: "leave.approved", noun: "Leave", label: "Leave Approved", description: "Triggers when a leave request is approved, for team calendars and chat.", sample: { id: "leave-1", code: "LV-1042", employeeId: employee.id, startDate: "2026-12-24", endDate: "2026-12-26", days: 3, halfDay: false } }),
  hookTrigger({ event: "payroll.approved", noun: "Payroll Run", label: "Payroll Approved", description: "Triggers when a month's payroll is approved.", sample: run }),
  hookTrigger({ event: "payroll.paid", noun: "Payroll Run", label: "Payroll Paid", description: "Triggers when a payroll run is marked paid.", sample: run }),
];
