// Pages the org dashboard blueprints render from the shared partials, as paths relative to the web app.
interface OrgDashboardPage {
  file: string;
  exportName: string;
}

export type OrgDashboardPageName =
  | 'userDetail'
  | 'userTable'
  | 'usersClient'
  | 'contactDetail'
  | 'contactTable'
  | 'contactsClient'
  | 'roles';

const NEXTJS_APP = 'src/app/(dashboard)';
const COMPONENTS = 'src/components';

export const NEXTJS_PAGES: Record<OrgDashboardPageName, OrgDashboardPage> = {
  userDetail: { file: `${NEXTJS_APP}/admin/users/[id]/user-detail.tsx`, exportName: 'UserDetail' },
  userTable: { file: `${COMPONENTS}/admin/user-table.tsx`, exportName: 'UserTable' },
  usersClient: { file: `${NEXTJS_APP}/admin/users/users.client.tsx`, exportName: 'UsersClient' },
  contactDetail: { file: `${NEXTJS_APP}/contacts/[id]/contact.client.tsx`, exportName: 'ContactDetail' },
  contactTable: { file: `${COMPONENTS}/contacts/contact-table.tsx`, exportName: 'ContactTable' },
  contactsClient: { file: `${NEXTJS_APP}/contacts/contacts.client.tsx`, exportName: 'ContactsClient' },
  roles: { file: `${NEXTJS_APP}/admin/roles/page.tsx`, exportName: 'default' },
};

export const TANSTACK_START_PAGES: Record<OrgDashboardPageName, OrgDashboardPage> = {
  userDetail: { file: `${COMPONENTS}/admin/user-detail.tsx`, exportName: 'UserDetail' },
  userTable: { file: `${COMPONENTS}/admin/user-table.tsx`, exportName: 'UserTable' },
  usersClient: { file: `${COMPONENTS}/admin/users-client.tsx`, exportName: 'UsersClient' },
  contactDetail: { file: `${COMPONENTS}/contacts/contact-detail.tsx`, exportName: 'ContactDetail' },
  contactTable: { file: `${COMPONENTS}/contacts/contact-table.tsx`, exportName: 'ContactTable' },
  contactsClient: { file: `${COMPONENTS}/contacts/contacts-client.tsx`, exportName: 'ContactsClient' },
  roles: { file: `${COMPONENTS}/admin/roles-page.tsx`, exportName: 'RolesPage' },
};
