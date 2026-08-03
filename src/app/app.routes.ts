import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent) },
  { path: 'assets', loadComponent: () => import('./features/assets/assets.component').then(m => m.AssetsComponent) },
  { path: 'checkout', loadComponent: () => import('./features/checkout/checkout.component').then(m => m.CheckoutComponent) },
  { path: 'rfid', loadComponent: () => import('./features/rfid/rfid-operations.component').then(m => m.RfidOperationsComponent) },
  { path: 'gps', loadComponent: () => import('./features/gps/gps-tracking.component').then(m => m.GpsTrackingComponent) },
  { path: 'inventory', loadComponent: () => import('./features/inventory/inventory.component').then(m => m.InventoryComponent) },
  { path: 'maintenance', loadComponent: () => import('./features/maintenance/maintenance.component').then(m => m.MaintenanceComponent) },
  { path: 'reports', loadComponent: () => import('./features/reports/reports.component').then(m => m.ReportsComponent) },
  { path: 'compliance', loadComponent: () => import('./features/compliance/compliance.component').then(m => m.ComplianceComponent) },
  { path: 'integrations', loadComponent: () => import('./features/integrations/integrations.component').then(m => m.IntegrationsComponent) },
  { path: 'admin', loadComponent: () => import('./features/admin/admin.component').then(m => m.AdminComponent) },
  { path: '**', redirectTo: 'dashboard' }
];

