export const ROLES = ['developer', 'tech_lead', 'product_owner', 'admin']

function normalize(raw) {
  const role = String(raw || '').trim().toLowerCase()
  return ROLES.includes(role) ? role : 'developer'
}

/** Display role, same precedence as the backend chat RBAC (user_metadata, then app_metadata). */
export function userRole(user) {
  return normalize(user?.user_metadata?.role || user?.app_metadata?.role)
}

/** Admin pages require the server-controlled app_metadata role; user_metadata is self-editable. */
export function isAdminUser(user) {
  return normalize(user?.app_metadata?.role) === 'admin'
}
