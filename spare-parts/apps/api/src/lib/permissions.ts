export const PERMISSIONS = {
  'parts.view': 'View catalogue and part details',
  'parts.edit': 'Create and edit parts, categories, equipment',
  'parts.images': 'Upload and manage part pictures',
  'inventory.view': 'View stock and transactions',
  'inventory.issue': 'Issue and return parts',
  'inventory.adjust': 'Stock adjustments, min/max levels',
  'inventory.transfer': 'Transfer stock between locations',
  'cart.use': 'Use the spare parts request cart',
  'pr.create': 'Create, edit and submit own PRs',
  'pr.view_all': 'View all PRs',
  'pr.view_approved': 'View approved PRs',
  'pr.approve': 'Approve or reject PRs at the assigned step',
  'po.view': 'View purchase orders',
  'po.create': 'Create and edit purchase orders',
  'po.approve': 'Approve purchase orders',
  'po.send': 'Send purchase orders to suppliers',
  'grn.view': 'View goods receipts',
  'grn.create': 'Receive goods',
  'suppliers.view': 'View suppliers',
  'suppliers.manage': 'Create and edit suppliers and supplier prices',
  'reports.view': 'View dashboard and reports',
  'export.run': 'Export data to Excel/CSV/PDF',
  'audit.view': 'View the audit log',
  'users.manage': 'Manage users and roles',
  'settings.manage': 'Company settings, workflows, numbering',
  'import.run': 'Import data from Excel',
  'backup.run': 'Backup and restore the database',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const ROLES: Record<string, { name: string; permissions: Permission[] }> = {
  ADMIN: { name: 'Administrator', permissions: ALL_PERMISSIONS },
  STORE_MANAGER: {
    name: 'Store / Maintenance Manager',
    permissions: [
      'parts.view', 'parts.edit', 'parts.images', 'inventory.view', 'inventory.issue', 'inventory.adjust',
      'inventory.transfer', 'cart.use', 'pr.create', 'pr.view_all', 'pr.approve', 'po.view', 'grn.view',
      'grn.create', 'suppliers.view', 'reports.view', 'export.run', 'audit.view',
    ],
  },
  REQUESTER: { name: 'Requester', permissions: ['parts.view', 'inventory.view', 'cart.use', 'pr.create'] },
  PROCUREMENT: {
    name: 'Procurement',
    permissions: [
      'parts.view', 'parts.edit', 'parts.images', 'inventory.view', 'cart.use', 'pr.create', 'pr.view_approved',
      'pr.approve', 'po.view', 'po.create', 'po.approve', 'po.send', 'grn.view', 'suppliers.view',
      'suppliers.manage', 'reports.view', 'export.run', 'audit.view',
    ],
  },
  APPROVER: {
    name: 'Management Approver',
    permissions: ['parts.view', 'inventory.view', 'pr.view_all', 'pr.approve', 'po.view', 'po.approve', 'grn.view',
      'suppliers.view', 'reports.view', 'export.run', 'audit.view'],
  },
  VIEWER: {
    name: 'Viewer',
    permissions: ['parts.view', 'inventory.view', 'pr.view_all', 'po.view', 'grn.view', 'suppliers.view', 'reports.view'],
  },
};

export const DEFAULT_PR_STEPS = [
  { level: 1, name: 'Maintenance / Store Manager', roleCode: 'STORE_MANAGER' },
  { level: 2, name: 'Procurement', roleCode: 'PROCUREMENT' },
  { level: 3, name: 'Management Approval', roleCode: 'APPROVER' },
];
