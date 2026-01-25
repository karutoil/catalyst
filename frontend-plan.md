# Aero Frontend - Implementation Plan

**Version:** 1.0.0  
**Technology Stack:** React + TypeScript + Vite  
**UI Framework:** TailwindCSS + shadcn/ui  
**State Management:** Zustand + TanStack Query  
**WebSocket Client:** Native WebSocket API with auto-reconnect  
**Date Created:** January 25, 2026

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Technology Stack](#technology-stack)
3. [Project Structure](#project-structure)
4. [Core Features](#core-features)
5. [Implementation Phases](#implementation-phases)
6. [Component Architecture](#component-architecture)
7. [State Management](#state-management)
8. [API Integration](#api-integration)
9. [WebSocket Integration](#websocket-integration)
10. [Routing Structure](#routing-structure)
11. [UI/UX Design](#uiux-design)
12. [Security Considerations](#security-considerations)
13. [Testing Strategy](#testing-strategy)
14. [Deployment](#deployment)

---

## Project Overview

Aero Frontend is a modern, responsive web application for managing game servers across multiple nodes. It provides a comprehensive dashboard for server management, real-time console access, file management, backups, alerts, and administrative functions.

### Key Capabilities
- **Multi-node server management** - Manage servers across multiple physical/virtual nodes
- **Real-time console streaming** - Live console output and command execution via WebSocket
- **File management** - Browse, upload, download, edit server files
- **Backup & restore** - Schedule and manage server backups
- **Alert monitoring** - Real-time alerts for server issues
- **Role-based access control** - Admin and user permission management
- **Scheduled tasks** - Automated server tasks (backups, restarts, commands)
- **Resource monitoring** - Real-time CPU, memory, network usage
- **SFTP access** - Direct file access credentials

---

## Technology Stack

### Core Framework
- **React 18** - UI framework with concurrent features
- **TypeScript 5** - Type-safe development
- **Vite 5** - Fast build tool and dev server

### UI/Styling
- **TailwindCSS 3** - Utility-first CSS framework
- **shadcn/ui** - High-quality, accessible component library
- **Lucide React** - Icon library
- **Radix UI** - Headless UI primitives
- **Framer Motion** - Animation library

### State & Data
- **Zustand** - Lightweight state management
- **TanStack Query (React Query)** - Server state management, caching, sync
- **Axios** - HTTP client with interceptors
- **Zod** - Runtime type validation

### Real-time Communication
- **Native WebSocket API** - Real-time server events
- **Custom WebSocket manager** - Auto-reconnect, event handling, subscriptions

### Forms & Validation
- **React Hook Form** - Performant form handling
- **Zod** - Schema validation

### Code Editor (for file editing)
- **Monaco Editor** - VSCode-powered code editor
- **@monaco-editor/react** - React wrapper

### Terminal Emulator
- **xterm.js** - Terminal emulator for console output
- **xterm-addon-fit** - Automatic terminal sizing
- **xterm-addon-web-links** - Clickable URLs in terminal

### Date/Time
- **date-fns** - Date manipulation and formatting

### Developer Tools
- **ESLint** - Code linting
- **Prettier** - Code formatting
- **TypeScript ESLint** - TypeScript linting rules

---

## Project Structure

```
aero-frontend/
├── public/
│   ├── favicon.ico
│   └── logo.svg
├── src/
│   ├── components/
│   │   ├── ui/                  # shadcn/ui components
│   │   │   ├── button.tsx
│   │   │   ├── card.tsx
│   │   │   ├── dialog.tsx
│   │   │   ├── dropdown-menu.tsx
│   │   │   ├── input.tsx
│   │   │   ├── table.tsx
│   │   │   ├── tabs.tsx
│   │   │   ├── toast.tsx
│   │   │   └── ...
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx    # Main app layout with sidebar
│   │   │   ├── Sidebar.tsx      # Navigation sidebar
│   │   │   ├── Header.tsx       # Top header with user menu
│   │   │   └── Breadcrumbs.tsx  # Page breadcrumbs
│   │   ├── auth/
│   │   │   ├── LoginForm.tsx
│   │   │   ├── RegisterForm.tsx
│   │   │   └── ProtectedRoute.tsx
│   │   ├── servers/
│   │   │   ├── ServerList.tsx
│   │   │   ├── ServerCard.tsx
│   │   │   ├── ServerDetails.tsx
│   │   │   ├── CreateServerModal.tsx
│   │   │   ├── ServerStatusBadge.tsx
│   │   │   ├── ServerControls.tsx
│   │   │   └── ServerMetrics.tsx
│   │   ├── console/
│   │   │   ├── ServerConsole.tsx
│   │   │   ├── ConsoleTerminal.tsx
│   │   │   └── ConsoleInput.tsx
│   │   ├── files/
│   │   │   ├── FileManager.tsx
│   │   │   ├── FileTree.tsx
│   │   │   ├── FileEditor.tsx
│   │   │   ├── FileUploader.tsx
│   │   │   └── FileContextMenu.tsx
│   │   ├── backups/
│   │   │   ├── BackupList.tsx
│   │   │   ├── CreateBackupModal.tsx
│   │   │   └── RestoreBackupModal.tsx
│   │   ├── nodes/
│   │   │   ├── NodeList.tsx
│   │   │   ├── NodeCard.tsx
│   │   │   ├── CreateNodeModal.tsx
│   │   │   └── NodeStats.tsx
│   │   ├── templates/
│   │   │   ├── TemplateList.tsx
│   │   │   ├── TemplateCard.tsx
│   │   │   └── CreateTemplateModal.tsx
│   │   ├── tasks/
│   │   │   ├── TaskList.tsx
│   │   │   ├── CreateTaskModal.tsx
│   │   │   └── TaskScheduleInput.tsx
│   │   ├── alerts/
│   │   │   ├── AlertList.tsx
│   │   │   ├── AlertCard.tsx
│   │   │   ├── AlertRulesList.tsx
│   │   │   └── CreateAlertRuleModal.tsx
│   │   ├── admin/
│   │   │   ├── UserManagement.tsx
│   │   │   ├── SystemStats.tsx
│   │   │   ├── AuditLogs.tsx
│   │   │   └── SystemHealth.tsx
│   │   └── shared/
│   │       ├── LoadingSpinner.tsx
│   │       ├── ErrorBoundary.tsx
│   │       ├── EmptyState.tsx
│   │       ├── ConfirmDialog.tsx
│   │       └── ResourceUsageChart.tsx
│   ├── pages/
│   │   ├── auth/
│   │   │   ├── LoginPage.tsx
│   │   │   └── RegisterPage.tsx
│   │   ├── dashboard/
│   │   │   └── DashboardPage.tsx
│   │   ├── servers/
│   │   │   ├── ServersPage.tsx
│   │   │   ├── ServerDetailsPage.tsx
│   │   │   ├── ServerConsolePage.tsx
│   │   │   └── ServerFilesPage.tsx
│   │   ├── nodes/
│   │   │   └── NodesPage.tsx
│   │   ├── templates/
│   │   │   └── TemplatesPage.tsx
│   │   ├── tasks/
│   │   │   └── TasksPage.tsx
│   │   ├── alerts/
│   │   │   └── AlertsPage.tsx
│   │   ├── admin/
│   │   │   ├── UsersPage.tsx
│   │   │   ├── SystemPage.tsx
│   │   │   └── AuditLogsPage.tsx
│   │   └── NotFoundPage.tsx
│   ├── hooks/
│   │   ├── useAuth.ts
│   │   ├── useWebSocket.ts
│   │   ├── useServers.ts
│   │   ├── useNodes.ts
│   │   ├── useTemplates.ts
│   │   ├── useTasks.ts
│   │   ├── useAlerts.ts
│   │   ├── useFileManager.ts
│   │   ├── useBackups.ts
│   │   ├── useConsole.ts
│   │   └── useDebounce.ts
│   ├── stores/
│   │   ├── authStore.ts
│   │   ├── websocketStore.ts
│   │   └── uiStore.ts
│   ├── services/
│   │   ├── api/
│   │   │   ├── client.ts          # Axios instance with interceptors
│   │   │   ├── auth.ts            # Auth API calls
│   │   │   ├── servers.ts         # Server API calls
│   │   │   ├── nodes.ts           # Node API calls
│   │   │   ├── templates.ts       # Template API calls
│   │   │   ├── files.ts           # File management API calls
│   │   │   ├── backups.ts         # Backup API calls
│   │   │   ├── tasks.ts           # Task API calls
│   │   │   ├── alerts.ts          # Alert API calls
│   │   │   └── admin.ts           # Admin API calls
│   │   ├── websocket/
│   │   │   ├── WebSocketManager.ts
│   │   │   ├── messageHandlers.ts
│   │   │   └── types.ts
│   │   └── storage/
│   │       └── localStorage.ts
│   ├── types/
│   │   ├── api.ts
│   │   ├── server.ts
│   │   ├── node.ts
│   │   ├── template.ts
│   │   ├── task.ts
│   │   ├── alert.ts
│   │   ├── backup.ts
│   │   ├── user.ts
│   │   └── websocket.ts
│   ├── utils/
│   │   ├── formatters.ts         # Date, size, percentage formatters
│   │   ├── validators.ts         # Form validators
│   │   ├── constants.ts          # App constants
│   │   └── helpers.ts            # Utility functions
│   ├── styles/
│   │   └── globals.css           # Global styles + Tailwind imports
│   ├── App.tsx
│   ├── main.tsx
│   └── vite-env.d.ts
├── .env.example
├── .eslintrc.cjs
├── .gitignore
├── index.html
├── package.json
├── postcss.config.js
├── tailwind.config.js
├── tsconfig.json
├── tsconfig.node.json
└── vite.config.ts
```

---

## Core Features

### 1. Authentication & Authorization
- **User registration** with email/password
- **Login** with JWT token management
- **Token refresh** on expiration
- **Protected routes** requiring authentication
- **Role-based access control** (admin vs user)
- **Logout** with token cleanup

### 2. Dashboard
- **System overview** - Total servers, nodes, alerts
- **Recent activity** - Server status changes, alerts
- **Quick actions** - Create server, view alerts
- **Resource usage graphs** - CPU, memory across all nodes
- **Server status distribution** - Running, stopped, crashed

### 3. Server Management
- **List servers** with filters (node, status, search)
- **Create server** from template
- **View server details** - Config, stats, logs
- **Server controls** - Start, stop, restart, kill
- **Update server** - Memory, CPU, environment
- **Delete server** with confirmation
- **Transfer server** between nodes
- **Server metrics** - Real-time CPU, memory, network

### 4. Real-time Console
- **Live console output** via WebSocket
- **Terminal emulator** with xterm.js
- **Command execution** - Send commands to server
- **Auto-scroll** to latest output
- **Search console** - Find text in output
- **Clear console** - Clear terminal
- **Copy output** - Copy text selection
- **Console history** - Previous commands

### 5. File Management
- **File tree navigation** - Browse server directories
- **File upload** - Drag & drop or select files
- **File download** - Download individual files
- **File/folder creation** - New files and directories
- **File/folder deletion** with confirmation
- **File editing** - Monaco editor with syntax highlighting
- **Compress files** - Create .tar.gz archives
- **Decompress archives** - Extract .tar.gz, .zip files
- **File permissions** - View/edit file modes
- **Context menu** - Right-click actions

### 6. Backup Management
- **List backups** for server
- **Create backup** - Manual backup creation
- **Restore backup** with confirmation
- **Delete backup** with confirmation
- **Backup size** - Display backup file size
- **Backup status** - In progress, completed, failed

### 7. Node Management
- **List nodes** - All registered nodes
- **View node details** - Hostname, location, resources
- **Create node** - Register new node
- **Update node** - Modify node settings
- **Delete node** - Remove node
- **Node status** - Online/offline indicator
- **Node resources** - Available CPU, memory, disk
- **Servers on node** - List of servers

### 8. Template Management
- **List templates** - Available server templates
- **View template** - Docker image, start command
- **Create template** - Define new template
- **Template variables** - Environment variable substitution

### 9. Scheduled Tasks
- **List tasks** - All scheduled tasks
- **Create task** - Schedule server actions
- **Update task** - Modify schedule or action
- **Delete task** - Remove task
- **Execute task** - Run immediately
- **Task types** - Backup, restart, command, stop, start
- **Cron schedule** - Visual cron editor
- **Task history** - Last execution times

### 10. Alert System
- **List alerts** - Active and resolved alerts
- **Filter alerts** - By severity, server, date
- **Resolve alert** - Mark as resolved
- **Bulk resolve** - Multiple alerts at once
- **Alert statistics** - Count by severity
- **Alert rules** - Create alert conditions
- **Alert notifications** - Real-time WebSocket alerts

### 11. Admin Features
- **User management** - List, create, delete users
- **System statistics** - Server counts, resource usage
- **System health** - Database, WebSocket, agent connections
- **Audit logs** - User actions and system events
- **All servers view** - Cross-user server management

---

## Implementation Phases

### Phase 1: Project Setup & Foundation (Week 1)
- [x] Initialize Vite + React + TypeScript project
- [x] Configure TailwindCSS and shadcn/ui
- [x] Set up project structure and directories
- [x] Configure ESLint and Prettier
- [x] Set up environment variables (.env)
- [x] Create API client with Axios
- [x] Set up React Router
- [x] Create base layout components
- [x] Implement error boundary
- [x] Set up Zustand stores

### Phase 2: Authentication (Week 1)
- [x] Create auth service with API calls
- [x] Implement auth store (Zustand)
- [x] Build login page and form
- [x] Build register page and form
- [x] Implement JWT token storage
- [x] Create protected route component
- [x] Add token refresh logic
- [x] Implement logout functionality
- [x] Add auth interceptors to Axios

### Phase 3: Dashboard & Navigation (Week 1-2)
- [x] Create app layout with sidebar
- [x] Build navigation sidebar
- [x] Implement breadcrumbs
- [x] Create dashboard page
- [x] Add system statistics cards
- [x] Create resource usage charts
- [x] Add recent activity feed
- [x] Implement quick actions

### Phase 4: Server Management (Week 2-3)
- [x] Create server API service
- [x] Build server list page with filters
- [x] Create server card component
- [x] Build create server modal
- [x] Implement server details page
- [x] Add server control buttons (start/stop/restart/kill)
- [x] Create server metrics display
- [x] Build update server modal
- [x] Add delete server confirmation
- [x] Implement server transfer modal
- [x] Add server status badges
- [x] Create TanStack Query hooks for servers
- [x] Wire transfer modal to real nodes data
- [x] Add success/error notifications to mutations

### Phase 5: WebSocket Integration (Week 3)
- [x] Create WebSocket manager class
- [x] Implement auto-reconnect logic
- [x] Add event subscription system
- [x] Create WebSocket store
- [x] Implement message handlers
- [ ] Add server state update handling
- [ ] Create console output handling
- [x] Add resource stats handling
- [x] Implement useWebSocket hook
- [x] Add connection status indicator
- [x] Create useServerMetrics hook for live metrics
- [x] Integrate live metrics into server details

### Phase 6: Real-time Console (Week 3-4)
- [ ] Install xterm.js and addons
- [ ] Create console terminal component
- [ ] Implement console WebSocket subscription
- [ ] Add console input component
- [ ] Create command history
- [ ] Add auto-scroll functionality
- [ ] Implement console search
- [ ] Add clear console button
- [ ] Create console page layout
- [ ] Add copy output functionality

### Phase 7: File Management (Week 4-5)
- [x] Create file API service
- [x] Build file tree component
- [x] Implement file list view
- [x] Add file upload with drag & drop
- [x] Create file download functionality
- [x] Build Monaco editor integration
- [x] Implement file/folder creation
- [x] Add file/folder deletion
- [x] Create compress/decompress actions
- [x] Add context menu for files
- [x] Implement breadcrumb navigation
- [x] Create file manager page

### Phase 8: Backup Management (Week 5)
- [x] Create backup API service
- [x] Build backup list component
- [x] Add create backup modal
- [x] Implement restore backup confirmation
- [x] Add delete backup confirmation
- [x] Create backup size formatter
- [x] Add backup status indicators
- [x] Integrate backups into server details

### Phase 9: Node Management (Week 5-6)
- [ ] Create node API service
- [ ] Build node list page
- [ ] Create node card component
- [ ] Add create node modal
- [ ] Implement node details view
- [ ] Add update node functionality
- [ ] Create delete node confirmation
- [ ] Add node status indicators
- [ ] Display node resource usage

### Phase 10: Template Management (Week 6)
- [ ] Create template API service
- [ ] Build template list page
- [ ] Create template card component
- [ ] Add template details view
- [ ] Build create template modal
- [ ] Display template variables
- [ ] Add template icon/image support

### Phase 11: Scheduled Tasks (Week 6-7)
- [ ] Create task API service
- [ ] Build task list page
- [ ] Create task card component
- [ ] Add create task modal with cron editor
- [ ] Implement update task modal
- [ ] Add delete task confirmation
- [ ] Create execute task button
- [ ] Display task execution history
- [ ] Add task type icons

### Phase 12: Alert System (Week 7)
- [ ] Create alert API service
- [ ] Build alert list page
- [ ] Create alert card component
- [ ] Add alert filtering
- [ ] Implement resolve alert action
- [ ] Add bulk resolve alerts
- [ ] Create alert statistics dashboard
- [ ] Build alert rules management
- [ ] Add create alert rule modal
- [ ] Implement real-time alert notifications
- [ ] Add alert badge in header

### Phase 13: Admin Features (Week 7-8)
- [ ] Create admin API service
- [ ] Build user management page
- [ ] Add create/delete user functionality
- [ ] Create system statistics page
- [ ] Build system health dashboard
- [ ] Implement audit logs page
- [ ] Add audit log filtering
- [ ] Create all servers admin view
- [ ] Add admin-only route protection

### Phase 14: Polish & UX (Week 8)
- [ ] Add loading states to all components
- [ ] Implement error handling and toasts
- [ ] Create empty states for lists
- [ ] Add confirmation dialogs
- [ ] Implement optimistic updates
- [ ] Add keyboard shortcuts
- [ ] Create onboarding tooltips
- [ ] Add dark mode support
- [ ] Optimize performance (React.memo, useMemo)
- [ ] Add responsive mobile layouts

### Phase 15: Testing (Week 8-9)
- [ ] Set up Vitest for unit tests
- [ ] Write tests for utility functions
- [ ] Test API service layer
- [ ] Test custom hooks
- [ ] Test Zustand stores
- [ ] Add React Testing Library
- [ ] Test critical components
- [ ] Test form validation
- [ ] Add E2E tests with Playwright

### Phase 16: Documentation & Deployment (Week 9)
- [ ] Write README.md
- [ ] Document environment variables
- [ ] Create component documentation
- [ ] Add inline code comments
- [ ] Set up Docker build
- [ ] Create nginx configuration
- [ ] Configure production build
- [ ] Add CI/CD pipeline
- [ ] Deploy to staging
- [ ] Deploy to production

---

## Component Architecture

### Component Hierarchy

```
App
├── ErrorBoundary
├── Router
│   ├── AuthRoutes
│   │   ├── LoginPage
│   │   └── RegisterPage
│   └── ProtectedRoutes
│       └── AppLayout
│           ├── Header
│           ├── Sidebar
│           └── MainContent
│               ├── DashboardPage
│               ├── ServersPage
│               │   ├── ServerList
│               │   └── ServerCard
│               ├── ServerDetailsPage
│               │   ├── ServerDetails
│               │   ├── ServerControls
│               │   └── ServerMetrics
│               ├── ServerConsolePage
│               │   └── ConsoleTerminal
│               ├── ServerFilesPage
│               │   └── FileManager
│               ├── NodesPage
│               ├── TemplatesPage
│               ├── TasksPage
│               ├── AlertsPage
│               └── AdminPages
└── ToastContainer
```

### Component Design Principles

1. **Single Responsibility** - Each component does one thing well
2. **Composition** - Build complex UIs from simple components
3. **Presentational vs Container** - Separate UI from logic
4. **Type Safety** - All props and state typed with TypeScript
5. **Accessibility** - ARIA labels, keyboard navigation
6. **Performance** - Memoization, lazy loading, code splitting

---

## State Management

### Zustand Stores

#### Auth Store
```typescript
interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  setUser: (user: User) => void;
}
```

#### WebSocket Store
```typescript
interface WebSocketState {
  isConnected: boolean;
  subscriptions: Set<string>;
  subscribe: (serverId: string) => void;
  unsubscribe: (serverId: string) => void;
  sendCommand: (serverId: string, command: string) => void;
}
```

#### UI Store
```typescript
interface UIState {
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark';
  toggleSidebar: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}
```

### TanStack Query

- **Server-side state** managed with React Query
- **Automatic caching** and background refetching
- **Optimistic updates** for better UX
- **Error retry logic** with exponential backoff
- **Query invalidation** on mutations

Key queries:
- `useServers` - List of servers
- `useServer(id)` - Single server details
- `useNodes` - List of nodes
- `useTemplates` - List of templates
- `useTasks` - List of tasks
- `useAlerts` - List of alerts
- `useBackups(serverId)` - Server backups

---

## API Integration

### Axios Configuration

```typescript
// Base configuration
const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3000',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor - Add auth token
apiClient.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Response interceptor - Handle errors
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401) {
      // Token expired - logout
      authStore.getState().logout();
    }
    return Promise.reject(error);
  }
);
```

### API Service Pattern

Each API module exports typed functions:

```typescript
// services/api/servers.ts
export const serversApi = {
  list: (params?: ServerListParams) => 
    apiClient.get<ApiResponse<Server[]>>('/api/servers', { params }),
  
  get: (id: string) => 
    apiClient.get<ApiResponse<Server>>(`/api/servers/${id}`),
  
  create: (data: CreateServerData) => 
    apiClient.post<ApiResponse<Server>>('/api/servers', data),
  
  update: (id: string, data: UpdateServerData) => 
    apiClient.put<ApiResponse<Server>>(`/api/servers/${id}`, data),
  
  delete: (id: string) => 
    apiClient.delete<ApiResponse<void>>(`/api/servers/${id}`),
  
  start: (id: string) => 
    apiClient.post<ApiResponse<void>>(`/api/servers/${id}/start`),
  
  stop: (id: string) => 
    apiClient.post<ApiResponse<void>>(`/api/servers/${id}/stop`),
  
  restart: (id: string) => 
    apiClient.post<ApiResponse<void>>(`/api/servers/${id}/restart`),
};
```

---

## WebSocket Integration

### WebSocket Manager

```typescript
class WebSocketManager {
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private subscriptions = new Set<string>();
  
  connect() {
    const token = localStorage.getItem('token');
    this.ws = new WebSocket(`ws://localhost:3000/ws?token=${token}`);
    
    this.ws.onopen = () => {
      console.log('WebSocket connected');
      this.reconnectAttempts = 0;
      // Resubscribe to all servers
      this.subscriptions.forEach(serverId => this.subscribe(serverId));
    };
    
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleMessage(message);
    };
    
    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    this.ws.onclose = () => {
      console.log('WebSocket disconnected');
      this.reconnect();
    };
  }
  
  subscribe(serverId: string) {
    this.subscriptions.add(serverId);
    this.send({
      type: 'subscribe',
      serverId,
    });
  }
  
  unsubscribe(serverId: string) {
    this.subscriptions.delete(serverId);
    this.send({
      type: 'unsubscribe',
      serverId,
    });
  }
  
  sendCommand(serverId: string, command: string) {
    this.send({
      type: 'console_input',
      serverId,
      input: command,
    });
  }
  
  private send(data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }
  
  private handleMessage(message: WebSocketMessage) {
    switch (message.type) {
      case 'server_log':
        // Emit to console component
        break;
      case 'server_state':
        // Update server state in React Query cache
        break;
      case 'resource_stats':
        // Update metrics display
        break;
    }
  }
  
  private reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      setTimeout(() => this.connect(), 1000 * this.reconnectAttempts);
    }
  }
}
```

### WebSocket Events

**From Backend:**
- `server_log` - Console output lines
- `server_state` - Server status changes
- `resource_stats` - CPU, memory, network usage
- `alert` - New alert created

**To Backend:**
- `subscribe` - Subscribe to server events
- `unsubscribe` - Unsubscribe from server
- `console_input` - Send command to server

---

## Routing Structure

```typescript
// App routes
const routes = [
  // Public routes
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  
  // Protected routes
  {
    path: '/',
    element: <ProtectedRoute><AppLayout /></ProtectedRoute>,
    children: [
      { path: '/', element: <Navigate to="/dashboard" /> },
      { path: '/dashboard', element: <DashboardPage /> },
      
      // Servers
      { path: '/servers', element: <ServersPage /> },
      { path: '/servers/:serverId', element: <ServerDetailsPage /> },
      { path: '/servers/:serverId/console', element: <ServerConsolePage /> },
      { path: '/servers/:serverId/files', element: <ServerFilesPage /> },
      
      // Nodes
      { path: '/nodes', element: <NodesPage /> },
      
      // Templates
      { path: '/templates', element: <TemplatesPage /> },
      
      // Tasks
      { path: '/tasks', element: <TasksPage /> },
      
      // Alerts
      { path: '/alerts', element: <AlertsPage /> },
      
      // Admin (protected by role)
      {
        path: '/admin',
        element: <AdminRoute />,
        children: [
          { path: '/admin/users', element: <UsersPage /> },
          { path: '/admin/system', element: <SystemPage /> },
          { path: '/admin/audit-logs', element: <AuditLogsPage /> },
        ],
      },
      
      // 404
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
```

---

## UI/UX Design

### Design System

#### Colors
- **Primary:** Blue (`#3B82F6`)
- **Success:** Green (`#10B981`)
- **Warning:** Yellow (`#F59E0B`)
- **Error:** Red (`#EF4444`)
- **Info:** Cyan (`#06B6D4`)

#### Server Status Colors
- `stopped` - Gray
- `installing` - Blue
- `starting` - Blue (animated)
- `running` - Green
- `stopping` - Orange
- `crashed` - Red
- `transferring` - Purple

#### Typography
- **Headings:** Inter font family
- **Body:** Inter font family
- **Code:** JetBrains Mono

### Key UI Patterns

#### Cards
- Used for servers, nodes, templates, alerts
- Hover effects for interactivity
- Status indicators (badges, dots)
- Action buttons on hover

#### Tables
- Used for users, audit logs, tasks
- Sortable columns
- Row actions (edit, delete)
- Pagination
- Search and filters

#### Modals
- Create/edit forms
- Confirmation dialogs
- Large modals for complex forms
- Keyboard shortcuts (Esc to close)

#### Toast Notifications
- Success messages (green)
- Error messages (red)
- Info messages (blue)
- Auto-dismiss after 5 seconds
- Action buttons (undo, details)

#### Loading States
- Skeleton loaders for lists
- Spinner for buttons
- Progress bars for uploads
- Shimmer effect for cards

#### Empty States
- Illustration or icon
- Descriptive message
- Call-to-action button
- Helpful tips

### Responsive Design

- **Mobile:** Single column, bottom nav
- **Tablet:** Two columns, collapsible sidebar
- **Desktop:** Multi-column layouts, fixed sidebar

---

## Security Considerations

### Authentication
- **JWT tokens** stored in localStorage
- **Token expiration** handled automatically
- **Logout on 401** responses
- **Secure password requirements** enforced

### Authorization
- **Role-based access control** - Check user role for admin routes
- **Permission checks** - Verify permissions before actions
- **Protected routes** - Redirect to login if unauthenticated

### Input Validation
- **Client-side validation** with Zod schemas
- **Sanitize user input** before sending to API
- **Prevent XSS** - React escapes by default
- **Validate file uploads** - Check file types and sizes

### WebSocket Security
- **Token authentication** in WebSocket connection
- **Message validation** - Verify message structure
- **Rate limiting** - Prevent spam

### HTTPS
- **Force HTTPS** in production
- **Secure cookies** for sessions
- **CORS configuration** - Only allow trusted origins

---

## Testing Strategy

### Unit Tests (Vitest)
- **Utility functions** - formatters, validators
- **API services** - Mock Axios responses
- **Zustand stores** - Test actions and state
- **Custom hooks** - Test with renderHook

### Component Tests (React Testing Library)
- **Forms** - Test validation and submission
- **Buttons** - Test click handlers
- **Lists** - Test rendering and filtering
- **Modals** - Test open/close behavior

### Integration Tests
- **Authentication flow** - Login → redirect → logout
- **Server management** - Create → start → stop → delete
- **File upload** - Select file → upload → verify

### E2E Tests (Playwright)
- **Critical user flows**
  - Register → login → create server → start server
  - Upload file → edit file → download file
  - Create backup → restore backup
  - Create alert rule → receive alert → resolve

### Test Coverage Goals
- **80%+ coverage** for critical paths
- **100% coverage** for utility functions
- **All API services** tested with mocked responses

---

## Deployment

### Build Configuration

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Run tests
npm run test

# Lint
npm run lint
```

### Environment Variables

```env
# API URL
VITE_API_URL=http://localhost:3000

# WebSocket URL
VITE_WS_URL=ws://localhost:3000/ws

# Environment
VITE_ENV=production
```

### Docker Build

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

### Nginx Configuration

```nginx
server {
  listen 80;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;

  # SPA routing
  location / {
    try_files $uri $uri/ /index.html;
  }

  # API proxy
  location /api/ {
    proxy_pass http://backend:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }

  # WebSocket proxy
  location /ws {
    proxy_pass http://backend:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_set_header Host $host;
  }

  # Compression
  gzip on;
  gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;
}
```

### CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
name: Deploy Frontend

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run test
      - run: npm run build
      - uses: docker/build-push-action@v4
        with:
          push: true
          tags: myregistry/aero-frontend:latest
```

---

## Additional Features (Future Enhancements)

### Phase 17+
- [ ] **Multi-language support** - i18n with react-i18next
- [ ] **User preferences** - Theme, timezone, notifications
- [ ] **Activity dashboard** - User activity graphs
- [ ] **Server templates marketplace** - Community templates
- [ ] **Webhook integration** - Discord, Slack notifications
- [ ] **Server cloning** - Duplicate servers
- [ ] **Bulk operations** - Start/stop multiple servers
- [ ] **Advanced search** - Search across all entities
- [ ] **Keyboard shortcuts panel** - Help overlay
- [ ] **Export data** - CSV, JSON exports
- [ ] **Drag & drop server sorting** - Custom ordering
- [ ] **Server groups** - Organize servers into categories
- [ ] **Two-factor authentication** - TOTP support
- [ ] **API key management** - Generate API keys for users
- [ ] **Server tags** - Label and filter servers
- [ ] **Collaborative editing** - Multiple users in console
- [ ] **Mobile app** - React Native version

---

## Dependencies

### Core Dependencies
```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0",
    "@tanstack/react-query": "^5.61.0",
    "zustand": "^5.0.2",
    "axios": "^1.7.7",
    "zod": "^3.23.8",
    "react-hook-form": "^7.53.2",
    "@hookform/resolvers": "^3.9.1",
    "date-fns": "^4.1.0",
    "lucide-react": "^0.462.0",
    "@radix-ui/react-dialog": "^1.1.2",
    "@radix-ui/react-dropdown-menu": "^2.1.2",
    "@radix-ui/react-select": "^2.1.2",
    "@radix-ui/react-tabs": "^1.1.1",
    "@radix-ui/react-toast": "^1.2.2",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.5",
    "@monaco-editor/react": "^4.6.0",
    "monaco-editor": "^0.52.2",
    "@xterm/xterm": "^5.5.0",
    "@xterm/addon-fit": "^0.10.0",
    "@xterm/addon-web-links": "^0.11.0",
    "framer-motion": "^11.13.5"
  },
  "devDependencies": {
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.3",
    "vite": "^5.4.11",
    "typescript": "^5.6.3",
    "tailwindcss": "^3.4.15",
    "postcss": "^8.4.49",
    "autoprefixer": "^10.4.20",
    "eslint": "^9.15.0",
    "prettier": "^3.3.3",
    "vitest": "^2.1.5",
    "@testing-library/react": "^16.0.1",
    "@testing-library/jest-dom": "^6.6.3",
    "@playwright/test": "^1.49.1"
  }
}
```

---

## Timeline & Resources

### Estimated Timeline
- **Total Duration:** 9-10 weeks
- **Team Size:** 2-3 frontend developers
- **Complexity:** Medium-High

### Resource Requirements
- **Senior React Developer** (1) - Architecture, complex features
- **Mid-level React Developer** (1-2) - UI components, pages
- **UI/UX Designer** (0.5) - Design system, mockups
- **QA Engineer** (0.5) - Testing, bug fixes

---

## Success Metrics

### Performance
- **Initial load:** < 3 seconds
- **Page transitions:** < 500ms
- **API response handling:** < 100ms
- **WebSocket latency:** < 50ms
- **Lighthouse score:** > 90

### Quality
- **Test coverage:** > 80%
- **TypeScript strict mode:** Enabled
- **No ESLint errors:** Required
- **Accessibility:** WCAG 2.1 AA compliant

### User Experience
- **Mobile responsive:** All pages
- **Cross-browser:** Chrome, Firefox, Safari, Edge
- **Error handling:** Graceful degradation
- **Loading states:** All async operations
- **User feedback:** Toasts for all actions

---

## Notes

- This plan is based on the backend API documentation version 1.0.0
- All features map directly to backend endpoints
- WebSocket integration is critical for real-time updates
- Security must be prioritized throughout development
- Accessibility should be considered from the start
- Regular code reviews and testing are essential

---

**Plan Created:** January 25, 2026  
**Last Updated:** January 25, 2026  
**Status:** Ready for Implementation
