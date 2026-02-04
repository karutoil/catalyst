/**
 * Example Plugin Frontend Entry
 * 
 * This file exports tab configurations that will be registered
 * by the Catalyst frontend plugin system.
 */

import { ExampleAdminTab, ExampleServerTab } from './components';

export const tabs = [
  {
    id: 'example-admin',
    label: 'Example Plugin',
    icon: 'Puzzle',
    component: ExampleAdminTab,
    location: 'admin',
    order: 100,
    requiredPermissions: ['admin.read'],
  },
  {
    id: 'example-server',
    label: 'Plugin Demo',
    icon: 'Zap',
    component: ExampleServerTab,
    location: 'server',
    order: 100,
    requiredPermissions: ['server.read'],
  },
];

export default tabs;
