export const ADMIN_ROLES = Object.freeze([
  'owner',
  'manager',
  'staff'
]);

export const ROLE_PERMISSIONS = Object.freeze({
  owner: Object.freeze([
    'dashboard:read',
    'products:read',
    'products:write',
    'services:read',
    'services:write',
    'advertisements:read',
    'advertisements:write',
    'orders:read',
    'orders:write',
    'customer_messages:read',
    'customer_messages:write',
    'payments:read',
    'payments:write',
    'posts:read',
    'posts:write',
    'issues:read',
    'issues:write',
    'books:read',
    'books:write',
    'team:read',
    'team:write',
    'security:manage'
  ]),

  manager: Object.freeze([
    'dashboard:read',
    'products:read',
    'products:write',
    'services:read',
    'services:write',
    'advertisements:read',
    'advertisements:write',
    'orders:read',
    'orders:write',
    'customer_messages:read',
    'customer_messages:write',
    'posts:read',
    'posts:write',
    'issues:read',
    'issues:write',
    'books:read',
    'books:write'
  ]),

  staff: Object.freeze([
    'dashboard:read',
    'products:read',
    'services:read',
    'advertisements:read',
    'orders:read',
    'customer_messages:read',
    'posts:read',
    'issues:read',
    'books:read'
  ])
});

export function hasPermission(role, permission) {
  return ROLE_PERMISSIONS[role]?.includes(permission) === true;
}

export function isAdminRole(role) {
  return ADMIN_ROLES.includes(role);
}
