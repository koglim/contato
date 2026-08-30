import { redirect } from "next/navigation";
import { hasDashboardAccess } from "../../lib/auth/dashboard";
import { DashboardShell } from "../../components/dashboard/shell";
export default async function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) { if (!(await hasDashboardAccess())) redirect("/dashboard/access"); return <DashboardShell>{children}</DashboardShell>; }
