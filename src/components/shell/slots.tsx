import { getSessionUser } from "@/server/dal";
import { MoreMenu } from "./more-menu";
import { ADMIN_NAV, NavLink } from "./nav";
import { UserMenu } from "./user-menu";

// Server components streamed into the static shell. They share one session lookup per
// request (getSessionUser is React-cached).

export async function AdminNavSlot() {
  const user = await getSessionUser();
  return user?.role === "admin" ? <NavLink item={ADMIN_NAV} /> : null;
}

export async function UserMenuSlot({ compact = false }: { compact?: boolean }) {
  const user = await getSessionUser();
  return user ? (
    <UserMenu name={user.name} email={user.email} compact={compact} />
  ) : null;
}

export async function MoreMenuSlot() {
  const user = await getSessionUser();
  return <MoreMenu isAdmin={user?.role === "admin"} />;
}
