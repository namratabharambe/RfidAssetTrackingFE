import { environment } from '../environments/environment';
import { Component, signal, computed, effect, ElementRef, ViewChild, AfterViewInit, OnDestroy, PLATFORM_ID, inject, NgZone } from '@angular/core';
import { isPlatformBrowser, DecimalPipe, UpperCasePipe } from '@angular/common';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { HttpClient } from '@angular/common/http';

import { FormsModule } from '@angular/forms';
import { Chart, registerables } from 'chart.js';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import * as XLSX from 'xlsx';
import { AuthService } from './services/auth.service';
import { ApiService } from './services/api.service';
import { firstValueFrom } from 'rxjs';

Chart.register(...registerables);

interface Asset {
  id: string;
  assetNumber?: string;
  name: string;
  image?: string;
  rfidTag: string;
  qrCode?: string;
  gpsId: string;
  serialNumber?: string;
  category: string;
  group?: string;
  manufacturer?: string;
  model?: string;
  purchaseDate?: string;
  warranty?: string;
  status: string;
  currentLocation?: string;
  currentCustodian?: string;
  custodian?: string;
  ownerDepartment?: string;
  industry?: string;
  businessUnit?: string;
  site?: string;
  zone?: string;
  assetType?: string;
  lastSeen?: string;
  nextMaintenance?: string;
  lastReader?: string;
  imei?: string;
  sim?: string;
  custodianEmail?: string;
  warrantyProvider?: string;
  warrantyStart?: string;
  warrantyEnd?: string;
  warrantyStatus?: 'Active' | 'Expired';
  vendorName?: string;
  vendorPhone?: string;
  vendorEmail?: string;
  serviceHistory?: {
    date: string;
    type: string;
    provider: string;
    remarks: string;
  }[];
}

interface EventItem {
  id: string;
  time: string;
  type: 'RFID Read' | 'GPS Ping' | 'Exception';
  assetId: string;
  assetName: string;
  category: string;
  location: string;
  details: string;
  source: string;
  operator: string;
}

interface SiteStats {
  totalAssets: number;
  activeAssets: number;
  activePct: string;
  assetsInUse: number;
  inUsePct: string;
  checkedOut: number;
  underMaintenance: number;
  maintenancePct: string;
  lowBatteryGps: number;
  rfidReadsToday: number;
  gpsPingsToday: number;
  exceptionAlerts: number;
  complianceTasks: number;
  
  // Sparkline values (last 7 points)
  utilizationSpark: number[];
  accuracySpark: number[];
  savingsSpark: number[];
  turnaroundSpark: number[];
  
  // Chart values
  utilizationOverTime: number[];
  statusCategory: number[]; // In Use, Available, Maintenance, Checked-Out, Retired
  movementInbound: number[]; // Dec to May
  movementOutbound: number[];
  movementUtilization: number[];
  topCategories: number[]; // Returnable, Material Handling, Tools, IT, Vehicles, Others
}

export interface GPSAsset {
  id: string;
  name: string;
  tag: string;
  type: 'Vehicle' | 'Forklift' | 'Pallet/Bin' | 'Container' | 'Tool/Equipment' | 'Mobile Equipment';
  lastGpsPing: string;
  lastRfidRead: string;
  currentZone: string;
  speed: number;
  battery: number;
  exception: string;
  status: string;
  make?: string;
  model?: string;
  direction?: string;
  operator?: string;
  shift?: string;
  odometer?: number;
  deviceId?: string;
  sim?: string;
  geofenceStatus?: 'Inside' | 'Outside' | 'Warning';
  latitude: number;
  longitude: number;
  x: number; // percentage width
  y: number; // percentage height
  site: string;
  trail: { x: number; y: number }[];
  timeline: { time: string; zone: string; details: string; type: 'moving' | 'idle' | 'stopped' | 'alert' }[];
}

export interface InventoryItem {
  id: string;
  sku: string;
  name: string;
  category: string;
  rfidTag: string;
  expectedQty: number;
  actualQty: number;
  unit: string;
  zone: string;
  binLocation: string;
  status: 'In Stock' | 'Low Stock' | 'Discrepancy' | 'Missing';
  lastAuditTime: string;
  checkedBy: string;
}

export interface MaintenanceAlert {
  id: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  assetId: string;
  assetType: string;
  alertType: string;
  currentSite: string;
  assignedTechnician: string;
  sla: string;
  status: 'Open' | 'In Progress' | 'Resolved';
  raisedTime: string;
  description?: string;
  vendor?: string;
  serviceLocation?: string;
  spares?: string[];
  estimatedCost?: number;
  gstInvoice?: string;
  estimatedDowntime?: string;
  notes?: string;
}

@Component({
  selector: 'app-root',
  imports: [DecimalPipe, UpperCasePipe, FormsModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly apiService = inject(ApiService);
  private readonly zone = inject(NgZone);

  protected readonly gpsMapMode = signal<'blueprint' | 'satellite'>('satellite');
  protected readonly gpsMapLayer = signal<'satellite' | 'hybrid' | 'street'>('satellite');
  protected readonly gpsAutoTrack = signal<boolean>(false);
  private satelliteMap: any = null;
  private satelliteMarkers: Map<string, any> = new Map();
  private satelliteTrailPolyline: any = null;
  private satelliteAccuracyCircles: Map<string, any> = new Map();
  private satelliteTileLayer: any = null;
  
  // Sidebar items
  protected readonly navItems = [
    { name: 'Dashboard', icon: 'space_dashboard', badge: null, submenus: null },
    { 
      name: 'Assets', 
      icon: 'inventory_2', 
      badge: null, 
      submenus: [
        'Asset Master & Inventory',
        'Asset Categories',
        'Asset Groups',
        'Bulk Upload',
        'Asset Audit'
      ] 
    },
    { name: 'Check in/Check out', icon: 'swap_horiz', badge: null, submenus: null },
    { 
      name: 'RFID Operations', 
      icon: 'contactless', 
      badge: null, 
      submenus: [
        'Scan Session Monitor',
        'Fixed Reader Monitor',
        'Handheld Sessions',
        'RFID Events',
        'Tag Management'
      ] 
    },
    { name: 'GPS Tracking', icon: 'location_on', badge: null, submenus: [] },
    { name: 'Inventory', icon: 'inventory', badge: null, submenus: [] },
    { name: 'Maintenance', icon: 'construction', badge: null, submenus: [] },
    { name: 'Reports & Analytics', icon: 'bar_chart', badge: null, submenus: [] },
    { name: 'Compliance', icon: 'assignment_turned_in', badge: null, submenus: ['Audit & Inspections', 'Geofence Violations', 'Certificates & Licenses'] },
    { name: 'Integrations', icon: 'hub', badge: null, submenus: null },
    { name: 'Admin', icon: 'admin_panel_settings', badge: null, submenus: ['User Management', 'Site & Warehouse Management', 'System Settings', 'Reader Profiles', 'API Management'] }
  ];

  // State Signals
  protected readonly isLoggedIn = signal<boolean>(false);
  protected readonly isSessionExpired = computed(() => this.authService.isSessionExpired());
  protected readonly sessionExpiredReason = computed(() => this.authService.sessionExpiredReason());
  protected readonly loginUsername = signal<string>('');
  protected readonly loginPassword = signal<string>('');
  protected readonly loginRememberMe = signal<boolean>(true);
  protected readonly loginErrorMessage = signal<string>('');
  protected readonly showPassword = signal<boolean>(false);

  protected closeSessionExpiredModal() {
    this.authService.closeSessionExpiredModal();
    this.isLoggedIn.set(false);
  }

  protected onSignIn(event: Event) {
    event.preventDefault();
    this.loginErrorMessage.set('');

    const username = this.loginUsername().trim();
    const password = this.loginPassword();

    if (!username || !password) {
      this.loginErrorMessage.set('Please enter both username and password.');
      return;
    }

    this.isLoading.set(true);
    this.authService.login({ username, password }).subscribe({
      next: (res) => {
        this.isLoading.set(false);
        this.isLoggedIn.set(true);
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem('isLoggedIn', 'true');
        }

        // Auto-select first site set in token / profile
        const userSites = this.allowedUserSites();
        if (userSites && userSites.length > 0) {
          const firstSite = userSites[0];
          if (firstSite && firstSite.name) {
            this.selectSite(firstSite.name, firstSite.id);
            return;
          }
        }
        this.loadAllApiData();
      },
      error: (err) => {
        this.isLoading.set(false);
        this.loginErrorMessage.set(err.error?.message || 'Invalid username or password.');
      }
    });
  }

  protected onLoginWithDevice() {
    this.loginUsername.set('devam@gmail.com');
    this.loginPassword.set('Password123!');
    this.onSignIn(new Event('submit'));
  }

  protected readonly isDevamUser = computed(() => {
    const user = this.authService.currentUser();
    const email = (user?.email || user?.username || '').toLowerCase();
    return email.includes('devam');
  });

  // Returns sites assigned to logged in user from claims/user profile
  protected readonly allowedUserSites = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return this.apiSites();

    if (user.allowedSites && Array.isArray(user.allowedSites) && user.allowedSites.length > 0) {
      return user.allowedSites;
    }
    if (user.sites_json) {
      try {
        const parsed = JSON.parse(user.sites_json);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((s: any) => ({
            id: s.Id || s.id,
            code: s.Code || s.code,
            name: s.Name || s.name
          }));
        }
      } catch (e) {}
    }
    if (user.sites && Array.isArray(user.sites) && user.sites.length > 0) {
      const siteGuids = user.sites.map((s: any) => typeof s === 'string' ? s : s.id || s.Id);
      const matched = this.apiSites().filter((s: any) => siteGuids.includes(s.id));
      if (matched.length > 0) return matched;
    }
    return this.apiSites();
  });

  // Returns warehouses assigned to logged in user from claims/user profile
  protected readonly allowedUserWarehouses = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return this.apiWarehouses();

    if (user.allowedWarehouses && Array.isArray(user.allowedWarehouses) && user.allowedWarehouses.length > 0) {
      return user.allowedWarehouses;
    }
    return this.apiWarehouses();
  });

  // Returns the set of site names this user is allowed to see.
  protected readonly allowedSiteNames = computed((): Set<string> | null => {
    const userSites = this.allowedUserSites();
    if (!userSites || userSites.length === 0) return null;
    const names = new Set<string>();
    userSites.forEach((s: any) => { if (s.name) names.add(s.name); });
    this.allowedUserWarehouses().forEach((w: any) => { if (w.name) names.add(w.name); });
    return names;
  });

  // Returns true if the given site name is visible to the current user.
  protected isSiteAllowed(siteName: string): boolean {
    const allowed = this.allowedSiteNames();
    if (!allowed) return true; // no restriction
    if (siteName === 'All Sites') return true; // label is always shown
    return allowed.has(siteName);
  }

  // Returns true if a record's site matches the current site filter.
  protected siteMatchesFilter(recordSite: string | null | undefined): boolean {
    const sel = this.selectedSite();
    const allowed = this.allowedSiteNames();

    if (sel === 'All Sites') {
      if (!allowed) return true;
      if (!recordSite) return false;
      return allowed.has(recordSite);
    }

    return recordSite === sel;
  }

  // System Settings: Module Access Config Signals
  protected readonly configModuleSiteName = signal<string>('All Sites');
  protected readonly configModuleWarehouseName = signal<string>('All Warehouses');
  protected readonly configModuleRole = signal<string>('All Roles');
  protected readonly siteModulePermissions = signal<Record<string, string[]>>({});

  protected toggleModulePermission(moduleName: string) {
    const site = this.configModuleSiteName();
    const wh = this.configModuleWarehouseName();
    const role = this.configModuleRole();
    const key = `${site}_${wh}_${role}`;
    
    const current = this.siteModulePermissions()[key] || [
      'Dashboard', 'Assets', 'Check in/Check out', 'RFID Operations', 'GPS Tracking', 
      'Inventory', 'Maintenance', 'Reports & Analytics', 'Compliance', 'Integrations', 'Admin'
    ];

    let updated: string[];
    if (current.includes(moduleName)) {
      updated = current.filter(m => m !== moduleName);
    } else {
      updated = [...current, moduleName];
    }

    const newMap = { ...this.siteModulePermissions(), [key]: updated };
    this.siteModulePermissions.set(newMap);
  }

  protected isModuleEnabledForConfig(moduleName: string): boolean {
    const site = this.configModuleSiteName();
    const wh = this.configModuleWarehouseName();
    const role = this.configModuleRole();
    const key = `${site}_${wh}_${role}`;
    const list = this.siteModulePermissions()[key];
    if (!list) return true; // Enabled by default
    return list.includes(moduleName);
  }

  protected fetchModulePermissionsFromApi() {
    if (!isPlatformBrowser(this.platformId)) return;
    const site = this.configModuleSiteName();
    const wh = this.configModuleWarehouseName();
    const role = this.configModuleRole();

    this.http.get<any>(`${environment.apiUrl}/systemsettings/module-permissions?site=${encodeURIComponent(site)}&warehouse=${encodeURIComponent(wh)}&role=${encodeURIComponent(role)}`).subscribe({
      next: (res) => {
        if (res && res.allConfigurations) {
          this.siteModulePermissions.set(res.allConfigurations);
        } else if (res && res.modules) {
          const key = `${site}_${wh}_${role}`;
          this.siteModulePermissions.set({ ...this.siteModulePermissions(), [key]: res.modules });
        }
      },
      error: () => {
        const saved = localStorage.getItem('site_module_permissions');
        if (saved) {
          try { this.siteModulePermissions.set(JSON.parse(saved)); } catch (e) {}
        }
      }
    });
  }

  protected saveModulePermissionsConfig() {
    if (!isPlatformBrowser(this.platformId)) return;
    const site = this.configModuleSiteName();
    const wh = this.configModuleWarehouseName();
    const role = this.configModuleRole();
    const key = `${site}_${wh}_${role}`;
    
    const modules = this.siteModulePermissions()[key] || [
      'Dashboard', 'Assets', 'Check in/Check out', 'RFID Operations', 'GPS Tracking', 
      'Inventory', 'Maintenance', 'Reports & Analytics', 'Compliance', 'Integrations', 'Admin'
    ];

    // Save to LocalStorage
    localStorage.setItem('site_module_permissions', JSON.stringify(this.siteModulePermissions()));

    // Save to Backend API (/api/systemsettings/module-permissions)
    this.http.post(`${environment.apiUrl}/systemsettings/module-permissions`, {
      site,
      warehouse: wh,
      role,
      modules
    }).subscribe({
      next: (res: any) => {
        if (res && res.allConfigurations) {
          this.siteModulePermissions.set(res.allConfigurations);
        }
        alert(`Successfully saved module permissions to backend database for Site: ${site}, Warehouse: ${wh}, Role: ${role}! The navigation sidebar has been dynamically updated.`);
      },
      error: (err) => {
        console.warn('Backend API save warning, saved locally', err);
        alert(`Saved module permissions locally for Site: ${site}, Warehouse: ${wh}, Role: ${role}! The navigation sidebar has been dynamically updated.`);
      }
    });
  }

  protected readonly filteredNavItems = computed(() => {
    const user = this.authService.currentUser();
    if (!user) return this.navItems;

    // Extract user roles (from JWT claims or user object)
    let userRoles: string[] = [];
    if (Array.isArray(user.roles)) {
      userRoles = user.roles.map((r: any) => (typeof r === 'string' ? r : r.name || '').toLowerCase());
    } else if (user.roleName || user.roleId || user.role) {
      userRoles = (user.roleName || user.roleId || user.role || '').toLowerCase().split(',').map((r: string) => r.trim());
    }

    // Role capabilities
    const isSiteAdmin = userRoles.length === 0 || userRoles.some(r => r.includes('admin') || r.includes('super') || r.includes('system'));
    const isProjectManager = userRoles.some(r => r.includes('manager') || r.includes('project'));
    const isWarehouseManager = userRoles.some(r => r.includes('warehouse') || r.includes('store'));
    const isAuditor = userRoles.some(r => r.includes('audit') || r.includes('compliance'));
    const isSupervisor = userRoles.some(r => r.includes('supervisor') || r.includes('operator'));

    // Site context restriction
    const isSiteRestricted = !!user.siteId || this.allowedSiteNames() !== null;

    // Determine base allowed sidebar items based on Role & Site restriction
    let allowedNames: string[] = [];
    if (isSiteAdmin) {
      allowedNames = ['Dashboard', 'Assets', 'Check in/Check out', 'RFID Operations', 'GPS Tracking', 'Inventory', 'Maintenance', 'Reports & Analytics', 'Compliance', 'Integrations', 'Admin'];
    } else if (isProjectManager) {
      allowedNames = ['Dashboard', 'Assets', 'Check in/Check out', 'RFID Operations', 'GPS Tracking', 'Inventory', 'Maintenance', 'Reports & Analytics', 'Compliance', 'Settings'];
    } else if (isWarehouseManager) {
      allowedNames = ['Dashboard', 'Assets', 'Check in/Check out', 'Inventory', 'Maintenance', 'Reports & Analytics', 'Settings'];
    } else if (isAuditor) {
      allowedNames = ['Dashboard', 'Assets', 'Inventory', 'Reports & Analytics', 'Compliance'];
    } else if (isSupervisor) {
      allowedNames = ['Dashboard', 'Assets', 'Check in/Check out', 'RFID Operations', 'Inventory', 'Maintenance'];
    } else {
      allowedNames = ['Dashboard', 'Assets', 'Check in/Check out', 'Inventory', 'Reports & Analytics', 'Settings'];
    }

    // Check custom System Settings module permissions for the selected site/warehouse/role
    const currentSite = this.selectedSite();
    const permissionsMap = this.siteModulePermissions();
    const matchingKey = Object.keys(permissionsMap).find(k => k.startsWith(currentSite) || k.startsWith('All Sites'));
    if (matchingKey && permissionsMap[matchingKey]) {
      const configuredModules = permissionsMap[matchingKey];
      allowedNames = allowedNames.filter(name => configuredModules.includes(name) || name === 'Settings' || name === 'Admin');
    }

    return this.navItems
      .map(item => {
        if (item.name === 'Admin') {
          if (isSiteAdmin) {
            return {
              ...item,
              submenus: isSiteRestricted 
                ? ['User Management', 'Site & Warehouse Management', 'System Settings', 'Reader Profiles']
                : item.submenus
            };
          }
          if (allowedNames.includes('Settings')) {
            return {
              name: 'Settings',
              icon: 'settings',
              badge: null,
              submenus: ['System Settings']
            };
          }
          return null;
        }
        return item;
      })
      .filter((item): item is typeof this.navItems[0] => item !== null && allowedNames.includes(item.name));
  });

  protected readonly selectedSite = signal<string>('');
  protected readonly selectedSiteId = signal<string | null>(null);
  protected readonly selectedWarehouseId = signal<string | null>(null);
  protected readonly isSiteDropdownOpen = signal<boolean>(false);

  protected toggleSiteDropdown() {
    this.isSiteDropdownOpen.update(v => !v);
    this.isNotificationOpen.set(false);
  }

  protected selectSite(siteName: string, siteId?: string, warehouseId?: string) {
    this.isSiteDropdownOpen.set(false);
    this.selectedSite.set(siteName);

    let resolvedSiteId = siteId;
    if (!resolvedSiteId && siteName !== 'All Sites') {
      const match = this.apiSites().find((s: any) => s.name.toLowerCase() === siteName.toLowerCase());
      if (match) resolvedSiteId = match.id;
    }

    this.selectedSiteId.set(resolvedSiteId || null);
    this.selectedWarehouseId.set(warehouseId || null);

    // Call backend API /api/auth/switch-context to issue a NEW CONTEXT TOKEN for selected site/warehouse!
    this.authService.switchContext(resolvedSiteId, warehouseId).subscribe({
      next: (res: any) => {
        console.log('Successfully switched token context for site:', siteName, res);
        this.loadAllApiData();
      },
      error: (err) => {
        console.warn('Error switching token context via API, re-fetching data locally:', err);
        this.loadAllApiData();
      }
    });
  }

  protected readonly activeOperation = signal<string>('All Operations');
  protected readonly activeNav = signal<string>('Dashboard');
  protected readonly activeSubNav = signal<string>('');
  
  protected readonly selectedDate = signal<string>(new Date().toISOString().split('T')[0]);
  protected readonly formattedSelectedDate = computed(() => {
    const dateStr = this.selectedDate();
    if (!dateStr) return 'Select Date';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = date.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  });

  protected getRelativeDateStr(offsetDays: number, format: 'yyyy-mm-dd' | 'd mmm yyyy' | 'd mmm yyyy, hh:mm:ss' | 'd mmm yyyy, hh:mm AM/PM' = 'd mmm yyyy', customTime?: string): string {
    const date = new Date();
    date.setDate(date.getDate() + offsetDays);
    const day = date.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    const pad = (n: number) => String(n).padStart(2, '0');
    
    if (format === 'yyyy-mm-dd') {
      return `${year}-${pad(date.getMonth() + 1)}-${pad(day)}`;
    }
    if (format === 'd mmm yyyy, hh:mm:ss') {
      return `${pad(day)} ${month} ${year}, ${customTime || '10:00:00'}`;
    }
    if (format === 'd mmm yyyy, hh:mm AM/PM') {
      return `${pad(day)} ${month} ${year}, ${customTime || '10:00 AM'}`;
    }
    return `${pad(day)} ${month} ${year}`;
  }

  protected currentMonthAndYear() {
    const today = new Date();
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    return `${months[today.getMonth()]} ${today.getFullYear()}`;
  }

  protected currentYear() {
    return new Date().getFullYear();
  }

  protected get calendarGrid() {
    const today = new Date();
    const year = today.getFullYear();
    const month = today.getMonth();
    
    // First day of current month
    const firstDay = new Date(year, month, 1);
    // Day of the week for first day (0 = Sun, 1 = Mon, ...)
    const startOffset = firstDay.getDay(); 
    
    const days: { day: number; isCurrentMonth: boolean }[] = [];
    
    // Days from previous month
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    for (let i = startOffset - 1; i >= 0; i--) {
      days.push({ day: prevMonthLastDay - i, isCurrentMonth: false });
    }
    
    // Days from current month
    const currentMonthLastDay = new Date(year, month + 1, 0).getDate();
    for (let i = 1; i <= currentMonthLastDay; i++) {
      days.push({ day: i, isCurrentMonth: true });
    }
    
    // Fill remaining grid to multiple of 7
    const remaining = 42 - days.length;
    for (let i = 1; i <= remaining; i++) {
      days.push({ day: i, isCurrentMonth: false });
    }
    
    return days;
  }
  
  // Reports & Analytics Page State
  protected readonly reportsSelectedSubnav = signal<string>('Operations');
  protected readonly reportsStartDate = signal<string>(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0]
  );
  protected readonly reportsEndDate = signal<string>(
    new Date().toISOString().split('T')[0]
  );
  protected readonly isReportsDatePickerOpen = signal<boolean>(false);
  protected readonly reportsDateRangeDisplay = computed(() => {
    const startStr = this.reportsStartDate();
    const endStr = this.reportsEndDate();
    if (!startStr || !endStr) return 'Select Date Range';
    
    const startDate = new Date(startStr);
    const endDate = new Date(endStr);
    
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const pad = (n: number) => String(n).padStart(2, '0');
    
    const startFormatted = `${pad(startDate.getDate())} ${months[startDate.getMonth()]} ${startDate.getFullYear()}`;
    const endFormatted = `${pad(endDate.getDate())} ${months[endDate.getMonth()]} ${endDate.getFullYear()}`;
    
    return `${startFormatted} - ${endFormatted}`;
  });
  protected readonly reportsSelectedSite = signal<string>('All Sites');
  protected readonly reportsSelectedCategory = signal<string>('All Categories');
  protected readonly reportsSelectedDepartment = signal<string>('All Departments');
  protected readonly reportsSelectedCustomerVendor = signal<string>('All');
  protected readonly isScheduleEmailModalOpen = signal<boolean>(false);
  protected readonly scheduleEmailAddress = signal<string>('trackit@prosper.com');
  protected readonly scheduleEmailFrequency = signal<string>('Weekly');
  protected readonly scheduleEmailFormat = signal<string>('PDF');
  protected readonly scheduleEmailTime = signal<string>('09:00 AM');
  protected readonly isShareModalOpen = signal<boolean>(false);
  protected readonly shareLinkCopied = signal<boolean>(false);
  protected readonly reportsExpandedSites = signal<Record<string, boolean>>({
    'India Operations (All Sites)': true
  });
  protected readonly reportsDataRefreshedTime = signal<string>(
    (() => {
      const today = new Date();
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const pad = (n: number) => String(n).padStart(2, '0');
      const timeStr = today.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
      return `${pad(today.getDate())} ${months[today.getMonth()]} ${today.getFullYear()}, ${timeStr}`;
    })()
  );
  protected readonly reportsIndiaOpsDropdownOpen = signal<boolean>(false);
  protected readonly expandedItems = signal<Record<string, boolean>>({ 'Assets': true });
  protected readonly isNotificationOpen = signal<boolean>(false);
  protected readonly searchQuery = signal<string>('');
  protected readonly currentTheme = signal<string>('light');

  // Compliance State
  protected readonly complianceScore = signal<number>(0);
  protected readonly complianceAudits = signal<any[]>([]);
  protected readonly complianceGeofenceViolations = signal<any[]>([]);
  protected readonly complianceCertificates = signal<any[]>([]);

  // Dashboard KPI: live checked-out count from checkoutRecords (assignments & scans)
  protected readonly checkedOutCount = computed(() => {
    const op = this.activeOperation();
    let list = this.checkoutRecords().filter(r => this.siteMatchesFilter(r.site));
    if (op !== 'All Operations') {
      list = list.filter(r => {
        const loc = (r.location || r.site || '').toLowerCase();
        if (op === 'Warehouse') return loc.includes('dc') || loc.includes('warehouse') || loc.includes('pune');
        if (op === 'Manufacturing') return loc.includes('plant') || loc.includes('mfg');
        if (op === 'Distribution') return loc.includes('hub') || loc.includes('dist');
        return true;
      });
    }
    return list.length;
  });

  // Integrations State
  protected readonly integrations = signal<any[]>([]);

  // Admin State
  protected readonly adminUsers = signal<any[]>([]);
  protected readonly filteredAdminUsers = computed(() => {
    const list = this.adminUsers();
    const currentUser = this.authService.currentUser();
    if (!currentUser) return list;

    const userEmail = (currentUser?.email || currentUser?.username || '').toLowerCase();
    const isDevam = userEmail.includes('devam');
    const allowedSiteNames = this.allowedSiteNames();

    if (!isDevam && !allowedSiteNames && !currentUser.siteId) {
      return list;
    }

    return list.filter(u => {
      const uEmail = (u.email || u.username || u.name || '').toLowerCase();

      if (isDevam && uEmail.includes('devam')) {
        return true;
      }

      if (allowedSiteNames && u.siteName && allowedSiteNames.has(u.siteName)) {
        return true;
      }

      if (currentUser.siteId && u.siteId && u.siteId.toLowerCase() === currentUser.siteId.toLowerCase()) {
        return true;
      }

      if (u.id === currentUser.id || uEmail === userEmail) {
        return true;
      }

      return false;
    });
  });
  protected readonly adminReaders = signal<any[]>([]);
  protected readonly adminApiKeys = signal<any[]>([]);

  // Site & Warehouse Admin State
  protected readonly adminSites = signal<any[]>([
    { id: 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c91', code: 'SITE-CS-00', name: 'Pune DC / Central Store Warehouse', address: 'Plot 42, Central Logistics Park, Pune' },
    { id: 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c92', code: 'SITE-ALP-01', name: 'Mumbai Warehouse / Site Alpha', address: 'Sector 14, Metro Pier 12, Mumbai' },
    { id: 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c93', code: 'SITE-BET-02', name: 'Chennai Plant / Site Beta', address: 'Plot 88, IT Park Zone, Chennai' },
    { id: 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c94', code: 'SITE-GAM-03', name: 'Bengaluru Hub / Site Gamma', address: 'KM 44, Expressway Project, Bengaluru' }
  ]);
  protected readonly isCreateSiteModalOpen = signal<boolean>(false);
  protected readonly formSiteCode = signal<string>('');
  protected readonly formSiteName = signal<string>('');
  protected readonly formSiteAddress = signal<string>('');

  protected openCreateSiteModal() {
    this.formSiteCode.set('');
    this.formSiteName.set('');
    this.formSiteAddress.set('');
    this.isCreateSiteModalOpen.set(true);
  }

  protected saveNewSite() {
    const name = this.formSiteName().trim();
    if (!name) return;
    const code = this.formSiteCode().trim() || ('SITE-' + Math.floor(100 + Math.random() * 900));
    const address = this.formSiteAddress().trim() || 'Construction Project Location';

    const newSite = {
      id: 'site-' + Date.now(),
      code,
      name,
      address
    };

    this.adminSites.update(list => [...list, newSite]);
    
    // Also push to HTTP backend if online
    this.http.post(`${environment.apiUrl}/sites`, { code, name, address }).subscribe({
      next: () => {
        console.log('Site created successfully in backend database');
        this.fetchSitesZonesWarehouses();
      },
      error: (err) => console.log('Stored locally', err)
    });

    this.isCreateSiteModalOpen.set(false);
  }

  // Warehouse Admin State
  protected readonly adminWarehouses = signal<any[]>([
    { id: 'wh-cs-01', code: 'WH-CS-01', name: 'Devam Central Store Warehouse', address: 'Plot 42, Central Logistics Park, Pune', siteId: 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c91', siteName: 'Pune DC / Central Store Warehouse' }
  ]);
  protected readonly isCreateWarehouseModalOpen = signal<boolean>(false);
  protected readonly formWarehouseCode = signal<string>('');
  protected readonly formWarehouseName = signal<string>('');
  protected readonly formWarehouseAddress = signal<string>('');
  protected readonly formWarehouseSiteId = signal<string>('');

  protected openCreateWarehouseModal() {
    this.formWarehouseCode.set('');
    this.formWarehouseName.set('');
    this.formWarehouseAddress.set('');
    this.formWarehouseSiteId.set(this.adminSites().length > 0 ? this.adminSites()[0].id : '');
    this.isCreateWarehouseModalOpen.set(true);
  }

  protected fetchWarehousesFromApi() {
    this.http.get<any[]>(`${environment.apiUrl}/warehouses`).subscribe({
      next: (data) => {
        if (Array.isArray(data)) {
          const currentUser = this.authService.currentUser();
          const userEmail = (currentUser?.email || currentUser?.username || '').toLowerCase();
          let filtered = data;
          if (userEmail.includes('devam')) {
            const allowedSiteIds = new Set(this.adminSites().map((s: any) => s.id));
            filtered = data.filter((w: any) => 
              allowedSiteIds.has(w.siteId) || 
              (w.name && w.name.toLowerCase().includes('devam')) || 
              (w.code && w.code.toLowerCase().includes('devam')) ||
              (w.name && w.name.toLowerCase().includes('central store'))
            );
          }
          this.adminWarehouses.set(filtered.map((w: any) => ({
            id: w.id,
            code: w.code || 'WH-01',
            name: w.name,
            address: w.address || 'Warehouse Location',
            siteId: w.siteId,
            siteName: w.siteName || (this.adminSites().find(s => s.id === w.siteId)?.name || 'Assigned Site')
          })));
        }
      },
      error: (err) => console.log('Stored locally', err)
    });
  }

  protected saveNewWarehouse() {
    const name = this.formWarehouseName().trim();
    if (!name) return;
    const code = this.formWarehouseCode().trim() || ('WH-' + Math.floor(100 + Math.random() * 900));
    const address = this.formWarehouseAddress().trim() || 'Central Storage Depot';
    const siteId = this.formWarehouseSiteId() || (this.adminSites().length > 0 ? this.adminSites()[0].id : null);

    const siteObj = this.adminSites().find(s => s.id === siteId);
    const newWh = {
      id: 'wh-' + Date.now(),
      code,
      name,
      address,
      siteId,
      siteName: siteObj ? siteObj.name : 'Central Store'
    };

    this.adminWarehouses.update(list => [...list, newWh]);

    this.http.post(`${environment.apiUrl}/warehouses`, { code, name, address, siteId }).subscribe({
      next: () => {
        console.log('Warehouse created in backend database');
        this.fetchWarehousesFromApi();
      },
      error: (err) => console.log('Warehouse stored locally', err)
    });

    this.isCreateWarehouseModalOpen.set(false);
  }

  // System Settings fields
  protected readonly sysOrgName = signal<string>('Prosper Asset Management Pvt Ltd');
  protected readonly sysTimezone = signal<string>('UTC+05:30 (Kolkata)');
  protected readonly sysUnitSystem = signal<string>('Metric');
  protected readonly sysEmailAlerts = signal<boolean>(true);
  protected readonly sysAuditLogging = signal<boolean>(true);

  // Scan Session Monitor State
  protected readonly isScanSessionRunning = signal<boolean>(false);
  protected readonly scanSessionTime = signal<string>('00:00:00');
  protected readonly scanTotalReadCount = signal<number>(0);
  protected readonly scanDuplicateCount = signal<number>(0);
  protected readonly isAutoScrollEnabled = signal<boolean>(true);
  protected readonly activeOperationFilter = signal<string>('All Operations');
  protected readonly scanEventsList = signal<any[]>([]);
  protected readonly scanExceptionUnknown = signal<number>(0);
  protected readonly scanExceptionDuplicate = signal<number>(0);
  protected readonly scanExceptionMissed = signal<number>(0);
  protected readonly scanExceptionUnauthorized = signal<number>(0);
  protected readonly activeGateReaderReads = signal<number>(0);
  protected readonly activeHandheldReaderReads = signal<number>(0);
  protected readonly activeForkliftReaderReads = signal<number>(0);
  protected readonly isAssignDropdownOpen = signal<boolean>(false);
  protected readonly isAssignTagModalOpen = signal<boolean>(false);
  protected readonly selectedEpcForAssignment = signal<string>('');
  protected readonly formAssignAssetId = signal<string>('');
  private scanSessionInterval: any;
  private scanTimerInterval: any;
  private gpsTimerInterval: any;
  private scanPollingInterval: any;
  protected readonly isLoading = signal<boolean>(false);
  protected readonly isMobileSidebarOpen = signal<boolean>(false);

  // User Modal State
  protected readonly isUserModalOpen = signal<boolean>(false);
  protected readonly userModalMode = signal<'add' | 'edit'>('add');
  protected readonly formUserId = signal<string>('');
  protected formUserUsername = '';
  protected formUserEmail = '';
  protected formUserPassword = '';
  protected formUserRole = 'Viewer';
  protected formUserSiteId = '';
  protected formUserWarehouseId = '';
  protected readonly formUserSelectedSiteIds = signal<string[]>([]);
  protected readonly formUserSelectedWarehouseIds = signal<string[]>([]);
  protected formUserIsActive = true;

  protected toggleUserSiteSelection(siteId: string) {
    const current = this.formUserSelectedSiteIds();
    if (current.includes(siteId)) {
      this.formUserSelectedSiteIds.set(current.filter(id => id !== siteId));
    } else {
      this.formUserSelectedSiteIds.set([...current, siteId]);
    }
  }

  protected isUserSiteSelected(siteId: string): boolean {
    return this.formUserSelectedSiteIds().includes(siteId);
  }

  protected toggleUserWarehouseSelection(whId: string) {
    const current = this.formUserSelectedWarehouseIds();
    if (current.includes(whId)) {
      this.formUserSelectedWarehouseIds.set(current.filter(id => id !== whId));
    } else {
      this.formUserSelectedWarehouseIds.set([...current, whId]);
    }
  }

  protected isUserWarehouseSelected(whId: string): boolean {
    return this.formUserSelectedWarehouseIds().includes(whId);
  }



  // Reader Modal State
  protected readonly isReaderModalOpen = signal<boolean>(false);
  protected readonly readerModalMode = signal<'add' | 'edit'>('add');
  protected readonly formReaderId = signal<string>('');
  protected formReaderName = '';
  protected formReaderModel = 'Zebra FX9600';
  protected formReaderIpAddress = '';
  protected formReaderPort = 5084;
  protected formReaderAntennaCount = 4;
  protected formReaderPowerDbm = 30;
  protected formReaderSiteId = 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c91';
  protected formReaderStatus = 'Online';

  // Handheld Modal State
  protected readonly isHandheldModalOpen = signal<boolean>(false);
  protected readonly handheldModalMode = signal<'add' | 'edit'>('add');
  protected readonly formHandheldId = signal<string>('');
  protected formHandheldName = '';
  protected formHandheldSerial = '';
  protected formHandheldModel = '';
  protected formHandheldUserId = '';

  protected readonly adminHandhelds = signal<any[]>([]);

  // Check in/Check out state
  protected readonly checkoutMode = signal<'issue' | 'return' | 'transfer'>('issue');
  protected readonly checkoutCustodian = signal<string>('');
  protected readonly checkoutSite = signal<string>('Pune DC');
  protected readonly checkoutExpectedReturn = signal<string>(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  protected readonly checkoutScannedAssets = signal<any[]>([]);
  protected readonly isCheckoutScanning = signal<boolean>(false);
  
  protected readonly checkoutCategory = signal<string>('Tool Room Tools');
  protected readonly checkoutRfidTag = signal<string>('');
  protected readonly checkoutAssigneeType = signal<string>('Employee');
  protected readonly checkoutAssignee = signal<string>('Amit Verma');
  protected readonly checkoutPurpose = signal<string>('');
  protected readonly checkoutExpectedReturnDate = signal<string>(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  protected readonly checkoutExpectedReturnTime = signal<string>('18:00');

  protected readonly checkoutAssetDetails = computed<Asset | null>(() => {
    const tag = this.checkoutRfidTag().trim();
    if (!tag) return null;
    const match = this.assets().find(a => a.rfidTag === tag || a.id === tag || a.assetNumber === tag);
    if (match) return match;
    if (tag === 'AST-TRC-001245') {
      return {
        id: 'AST-TRC-001245',
        assetNumber: 'AST-TRC-001245',
        name: 'Torque Wrench Set 1/2"',
        category: 'Returnable Container',
        rfidTag: 'AST-TRC-001245',
        gpsId: 'GPS-TRC-001245',
        status: 'Available',
        custodian: '—',
        site: 'Pune DC',
        zone: 'Zone A',
        lastSeen: 'Just now',
        nextMaintenance: (() => {
          const d = new Date();
          d.setDate(d.getDate() + 36);
          const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
          return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
        })()
      } as Asset;
    }
    return null;
  });

  protected readonly checkoutFilter = signal<string>('All');
  protected readonly checkoutRecords = signal<any[]>([]);
  protected readonly checkinRecords = signal<any[]>([]);

  protected readonly checkoutFilterOptions = computed(() => {
    const names = new Set<string>();
    this.checkoutRecords().forEach(r => {
      if (r.entity) names.add(r.entity);
    });
    this.checkinRecords().forEach(r => {
      if (r.entity) names.add(r.entity);
    });
    return ['All', ...Array.from(names)];
  });

  protected readonly filteredCheckoutRecords = computed(() => {
    const f = this.checkoutFilter();
    const op = this.activeOperation();
    let list = this.checkoutRecords().filter(r => this.siteMatchesFilter(r.site));
    if (op !== 'All Operations') {
      list = list.filter(r => {
        const loc = (r.location || r.site || '').toLowerCase();
        if (op === 'Warehouse') return loc.includes('dc') || loc.includes('warehouse') || loc.includes('pune');
        if (op === 'Manufacturing') return loc.includes('plant') || loc.includes('mfg');
        if (op === 'Distribution') return loc.includes('hub') || loc.includes('dist');
        return true;
      });
    }
    if (f === 'All') return list;
    return list.filter(r => r.equipment === f || r.entity === f);
  });

  protected readonly filteredCheckinRecords = computed(() => {
    const f = this.checkoutFilter();
    const op = this.activeOperation();
    let list = this.checkinRecords().filter(r => this.siteMatchesFilter(r.site));
    if (op !== 'All Operations') {
      list = list.filter(r => {
        const loc = (r.location || r.site || '').toLowerCase();
        if (op === 'Warehouse') return loc.includes('dc') || loc.includes('warehouse') || loc.includes('pune');
        if (op === 'Manufacturing') return loc.includes('plant') || loc.includes('mfg');
        if (op === 'Distribution') return loc.includes('hub') || loc.includes('dist');
        return true;
      });
    }
    if (f === 'All') return list;
    return list.filter(r => r.equipment === f || r.entity === f);
  });

  protected getCheckoutCountForFilter(opt: string): number {
    const op = this.activeOperation();
    let list = this.checkoutRecords().filter(r => this.siteMatchesFilter(r.site));
    if (op !== 'All Operations') {
      list = list.filter(r => {
        const loc = (r.location || r.site || '').toLowerCase();
        if (op === 'Warehouse') return loc.includes('dc') || loc.includes('warehouse') || loc.includes('pune');
        if (op === 'Manufacturing') return loc.includes('plant') || loc.includes('mfg');
        if (op === 'Distribution') return loc.includes('hub') || loc.includes('dist');
        return true;
      });
    }
    if (opt === 'All') return list.length;
    return list.filter(r => r.equipment === opt || r.entity === opt).length;
  }

  protected toggleCheckOutStatus(record: any) {
    if (!record.raw || !record.raw.id) return;
    const updated = {
      ...record.raw,
      actualReturnDate: new Date().toISOString(),
      status: 'Returned'
    };
    this.apiService.updateAssignment(record.raw.id, updated).subscribe({
      next: () => {
        this.fetchAssignments();
      },
      error: (err) => {
        console.error('Failed to check in asset assignment', err);
      }
    });
  }

  protected toggleCheckInStatus(record: any) {
    if (!record.raw || !record.raw.id) return;
    const newAssignment = {
      assetId: record.raw.assetId,
      assignedToUserId: record.raw.assignedToUserId,
      custodianName: record.raw.custodianName,
      assignedDate: new Date().toISOString(),
      expectedReturnDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      purpose: record.raw.purpose || 'Re-checked out from dashboard',
      status: 'Active'
    };
    this.apiService.createAssignment(newAssignment).subscribe({
      next: () => {
        this.fetchAssignments();
      },
      error: (err) => {
        console.error('Failed to create check out assignment', err);
      }
    });
  }

  protected readonly checkoutTransactions = signal<any[]>([]);



  // Issue Return Work Orders state
  protected readonly issueActiveTab = signal<'active' | 'history' | 'create'>('active');
  protected readonly issueWorkOrders = signal<any[]>([]);
  protected readonly newIssueWorkOrder = signal<string>('');
  protected readonly newIssueProject = signal<string>('');
  protected readonly newIssueCustodian = signal<string>('');
  protected readonly newIssueExpectedReturn = signal<string>(new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
  protected readonly newIssueSelectedAssets = signal<any[]>([]);

  // Inventory Tracking State
  protected readonly inventorySearchQuery = signal<string>('');
  protected readonly inventoryStatusFilter = signal<string>('All');
  protected readonly inventoryZoneFilter = signal<string>('All');
  protected readonly inventorySelectedItem = signal<InventoryItem | null>(null);
  protected readonly isReconciling = signal<boolean>(false);
  protected readonly reconciliationProgress = signal<number>(0);

  protected readonly inventoryItems = signal<InventoryItem[]>([]);

  protected readonly filteredInventoryItems = computed(() => {
    const search = this.inventorySearchQuery().toLowerCase().trim();
    const status = this.inventoryStatusFilter();
    const zone = this.inventoryZoneFilter();
    let list = this.inventoryItems();

    // InventoryItem has no 'site' field; filter by zone name when a specific site is selected
    const sel = this.selectedSite();
    if (sel !== 'All Sites') {
      list = list.filter(item => item.zone && item.zone.toLowerCase().includes(sel.toLowerCase()));
    }

    if (search) {
      list = list.filter(item => 
        item.name.toLowerCase().includes(search) || 
        item.sku.toLowerCase().includes(search) || 
        item.rfidTag.toLowerCase().includes(search) ||
        item.id.toLowerCase().includes(search)
      );
    }

    if (status !== 'All') {
      list = list.filter(item => item.status === status);
    }

    if (zone !== 'All') {
      list = list.filter(item => item.zone === zone);
    }

    return list;
  });

  protected readonly inventoryStats = computed(() => {
    const list = this.filteredInventoryItems();
    const totalItems = list.length;
    const discrepancies = list.filter(item => item.status === 'Discrepancy' || item.status === 'Missing').length;
    const lowStock = list.filter(item => item.status === 'Low Stock').length;
    const matchedCount = list.filter(item => item.status === 'In Stock').length;
    const accuracy = totalItems > 0 ? Math.round((matchedCount / totalItems) * 100) : 100;
    
    return {
      totalItems,
      discrepancies,
      lowStock,
      accuracy,
      matchedCount
    };
  });

  // Maintenance Tracking State
  protected readonly maintSearchQuery = signal<string>('');
  protected readonly maintSeverityFilter = signal<string>('All');
  protected readonly maintTypeFilter = signal<string>('All');
  protected readonly maintSiteFilter = signal<string>('All');
  protected readonly maintSelectedAlert = signal<MaintenanceAlert | null>(null);

  protected readonly maintAlerts = signal<MaintenanceAlert[]>([]);

  protected readonly filteredMaintAlerts = computed(() => {
    const search = this.maintSearchQuery().toLowerCase().trim();
    const severity = this.maintSeverityFilter();
    const type = this.maintTypeFilter();
    const site = this.maintSiteFilter();
    const globalSite = this.selectedSite();
    let list = this.maintAlerts();

    list = list.filter(item => this.siteMatchesFilter(item.currentSite));

    if (search) {
      list = list.filter(item => 
        item.assetId.toLowerCase().includes(search) || 
        item.alertType.toLowerCase().includes(search) || 
        item.assetType.toLowerCase().includes(search) ||
        item.id.toLowerCase().includes(search)
      );
    }

    if (severity !== 'All') {
      list = list.filter(item => item.severity === severity);
    }

    if (type !== 'All') {
      list = list.filter(item => item.assetType === type);
    }

    if (site !== 'All') {
      list = list.filter(item => item.currentSite.includes(site));
    }

    return list;
  });

  protected readonly techniciansList = ['Sunil Pawar', 'Amit Verma', 'Mahesh Nair', 'Prakash Jadhav', 'Imran Shaikh', 'Karthik R', 'Ravi Singh'];
  protected readonly vendorsList = ['TechServe Solutions Pvt. Ltd.', 'Global Repairs Co.', 'ProsperSmart Services'];
  protected readonly locationsList = ['Mumbai - Bhiwandi Service Center', 'Pune DC - Workshop', 'Bengaluru Service Depot', 'Chennai Service Center', 'Delhi Service Center', 'Hyderabad Service Center', 'Ahmedabad Service Depot'];
  protected readonly sparesList = ['GPS Tracker Battery Pack', 'SIM Data Plan', 'RFID Tag Shell', 'Replacement Bracket'];
  protected readonly selectedCalendarDay = signal<number>(new Date().getDate());

  // Tag Management State
  protected readonly tagSearchQuery = signal<string>('');
  protected readonly tagStatusFilter = signal<string>('All');
  protected readonly tagTypeFilter = signal<string>('All');
  protected readonly isRegisterTagModalOpen = signal<boolean>(false);
  protected readonly newTagEpc = signal<string>('');
  protected readonly newTagAssetId = signal<string>('');
  protected readonly newTagType = signal<string>('RFID Pass-Metal');
  protected readonly newTagStatus = signal<string>('Active');

  protected readonly tagsList = signal<any[]>([]);

  protected readonly filteredTagsList = computed(() => {
    const search = this.tagSearchQuery().toLowerCase().trim();
    const status = this.tagStatusFilter();
    const type = this.tagTypeFilter();
    let list = this.tagsList();

    if (search) {
      list = list.filter(item => 
        item.epc.toLowerCase().includes(search) || 
        item.assetNumber.toLowerCase().includes(search) || 
        item.assetName.toLowerCase().includes(search) || 
        item.lastSeen.toLowerCase().includes(search)
      );
    }

    if (status !== 'All') {
      list = list.filter(item => item.status === status);
    }

    if (type !== 'All') {
      list = list.filter(item => item.rawType === type);
    }

    return list;
  });

  protected readonly tagStats = computed(() => {
    const list = this.tagsList();
    const totalTags = list.length;
    const activeTags = list.filter(t => t.status === 'Active').length;
    const availableTags = list.filter(t => t.assetNumber === '-').length;
    const damagedTags = list.filter(t => t.status === 'Inactive' || t.status === 'Damaged').length;
    const lowBatteryTags = list.filter(t => t.battery !== '-' && parseFloat(t.battery) <= 15).length;

    return {
      totalTags,
      activeTags,
      availableTags,
      damagedTags,
      lowBatteryTags
    };
  });

  protected fetchTags() {
    if (!this.isLoggedIn()) return;
    import('rxjs').then(({ forkJoin }) => {
      forkJoin({
        rfid: this.http.get<any>(`${environment.apiUrl}/rfidtags?page=1&size=200`),
        barcode: this.http.get<any>(`${environment.apiUrl}/barcodes?page=1&size=200`),
        gps: this.http.get<any>(`${environment.apiUrl}/gpsdevices?page=1&size=200`)
      }).subscribe({
        next: (res) => {
          const list: any[] = [];

          // 1. Add RFID tags
          const rfidList: any[] = Array.isArray(res.rfid) ? res.rfid : (res.rfid?.body ?? []);
          if (Array.isArray(rfidList)) {
            rfidList.forEach(t => {
              const asset = this.assets().find(a => (a.id || '').toString().toLowerCase() === (t.assetId || t.AssetId || '').toString().toLowerCase());
              list.push({
                id: t.id,
                epc: t.epcCode || t.EpcCode,
                assetNumber: asset ? asset.assetNumber : '-',
                assetName: asset ? asset.name : 'Unassigned',
                type: 'RFID Pass-Metal',
                RSSI: '-64 dBm',
                battery: '100%',
                lastSeen: 'Gate 2 Reader',
                time: 'Just now',
                status: t.status || 'Active',
                rawType: 'RFID'
              });
            });
            this.rfidTagsPool.set(rfidList);
          }

          // 2. Add Barcodes
          const bcList: any[] = Array.isArray(res.barcode) ? res.barcode : (res.barcode?.body ?? []);
          if (Array.isArray(bcList)) {
            bcList.forEach(b => {
              const asset = this.assets().find(a => (a.id || '').toString().toLowerCase() === (b.assetId || b.AssetId || '').toString().toLowerCase());
              list.push({
                id: b.id,
                epc: b.barcodeValue || b.BarcodeValue,
                assetNumber: asset ? asset.assetNumber : '-',
                assetName: asset ? asset.name : 'Unassigned',
                type: 'Barcode ' + (b.format || 'Standard'),
                RSSI: '-',
                battery: '-',
                lastSeen: 'Staging Scan',
                time: 'Just now',
                status: b.isActive ? 'Active' : 'Inactive',
                rawType: 'Barcode'
              });
            });
            this.barcodesPool.set(bcList);
          }

          // 3. Add GPS Devices
          const gpsList: any[] = Array.isArray(res.gps) ? res.gps : (res.gps?.body ?? []);
          if (Array.isArray(gpsList)) {
            gpsList.forEach(g => {
              const asset = this.assets().find(a => (a.id || '').toString().toLowerCase() === (g.assetId || g.AssetId || '').toString().toLowerCase());
              list.push({
                id: g.id,
                epc: g.imei || g.Imei,
                assetNumber: asset ? asset.assetNumber : '-',
                assetName: asset ? asset.name : 'Unassigned',
                type: 'GPS Active Device',
                RSSI: '-72 dBm',
                battery: (g.batteryLevel || 100) + '%',
                lastSeen: 'GPS Network',
                time: 'Just now',
                status: g.status === 'Online' ? 'Active' : 'Inactive',
                rawType: 'GPS'
              });
            });
            this.gpsDevicesPool.set(gpsList);
          }

          this.tagsList.set(list);
          this.fetchAssets();
        },
        error: (err) => console.error('Failed to load tags from backend', err)
      });
    });
  }

  protected registerNewTag() {
    const epc = this.newTagEpc().trim();
    if (!epc) return;

    if (this.tagsList().some(t => t.epc === epc)) {
      alert('Tag ID / EPC / Value already exists!');
      return;
    }

    let resolvedAssetGuid: string | null = null;
    const enteredAsset = this.newTagAssetId().trim();
    if (enteredAsset && enteredAsset !== '-') {
      const asset = this.assets().find(a => a.assetNumber === enteredAsset || a.name === enteredAsset || a.id === enteredAsset);
      if (asset) {
        resolvedAssetGuid = asset.id;
      }
    }

    const type = this.newTagType();
    let url = `${environment.apiUrl}/rfidtags`;
    let payload: any = {};

    if (type === 'RFID') {
      payload = {
        epcCode: epc,
        tidCode: null,
        assetId: resolvedAssetGuid,
        status: this.newTagStatus()
      };
    } else if (type === 'Barcode') {
      url = `${environment.apiUrl}/barcodes`;
      payload = {
        barcodeValue: epc,
        format: 'Code128',
        assetId: resolvedAssetGuid,
        isActive: this.newTagStatus() === 'Active'
      };
    } else if (type === 'GPS') {
      url = `${environment.apiUrl}/gpsdevices`;
      payload = {
        imei: epc,
        simNumber: null,
        assetId: resolvedAssetGuid,
        status: this.newTagStatus() === 'Active' ? 'Online' : 'Offline'
      };
    }

    this.http.post(url, payload).subscribe({
      next: () => {
        this.fetchTags();
        this.isRegisterTagModalOpen.set(false);
        this.newTagEpc.set('');
        this.newTagAssetId.set('');
      },
      error: (err) => {
        console.error('Failed to register tag', err);
        const detail = err.error?.message || err.error || err.message || 'Unknown error';
        alert('Failed to register tag: ' + detail);
      }
    });
  }

  protected decommissionTag(epc: string) {
    if (confirm(`Are you sure you want to decommission tag ${epc}?`)) {
      const tag = this.tagsList().find(t => t.epc === epc);
      if (tag && tag.id) {
        let url = `${environment.apiUrl}/rfidtags`;
        if (tag.rawType === 'Barcode') url = `${environment.apiUrl}/barcodes`;
        else if (tag.rawType === 'GPS') url = `${environment.apiUrl}/gpsdevices`;

        this.http.delete(`${url}/${tag.id}`).subscribe({
          next: () => this.fetchTags(),
          error: (err) => console.error('Failed to decommission tag', err)
        });
      }
    }
  }

  protected toggleTagStatus(epc: string) {
    const tag = this.tagsList().find(t => t.epc === epc);
    if (tag && tag.id) {
      if (tag.rawType === 'RFID') {
        const nextStatus = tag.status === 'Active' ? 'Damaged' : (tag.status === 'Damaged' ? 'Available' : 'Active');
        const matchedPool = this.rfidTagsPool().find(t => t.id === tag.id);
        const payload = {
          ...matchedPool,
          status: nextStatus
        };
        this.http.put(`${environment.apiUrl}/rfidtags/${tag.id}`, payload).subscribe({
          next: () => this.fetchTags(),
          error: (err) => console.error('Failed to toggle RFID status', err)
        });
      } else if (tag.rawType === 'Barcode') {
        const matchedPool = this.barcodesPool().find(b => b.id === tag.id);
        const payload = {
          ...matchedPool,
          isActive: !matchedPool.isActive
        };
        this.http.put(`${environment.apiUrl}/barcodes/${tag.id}`, payload).subscribe({
          next: () => this.fetchTags(),
          error: (err) => console.error('Failed to toggle Barcode status', err)
        });
      } else if (tag.rawType === 'GPS') {
        const matchedPool = this.gpsDevicesPool().find(g => g.id === tag.id);
        const nextStatus = matchedPool.status === 'Online' ? 'Offline' : 'Online';
        const payload = {
          ...matchedPool,
          status: nextStatus
        };
        this.http.put(`${environment.apiUrl}/gpsdevices/${tag.id}`, payload).subscribe({
          next: () => this.fetchTags(),
          error: (err) => console.error('Failed to toggle GPS status', err)
        });
      }
    }
  }

  protected isLowBattery(batteryStr: string): boolean {
    if (!batteryStr || batteryStr === '-') return false;
    const val = parseFloat(batteryStr);
    return !isNaN(val) && val <= 15;
  }

  // Fixed Reader Monitor State
  protected readonly fixedReaderSearchQuery = signal<string>('');
  protected readonly fixedReaderStatusFilter = signal<string>('All');
  
  protected readonly fixedReadersList = signal<any[]>([]);

  protected readonly filteredFixedReadersList = computed(() => {
    const search = this.fixedReaderSearchQuery().toLowerCase().trim();
    const status = this.fixedReaderStatusFilter();
    let list = this.fixedReadersList();

    if (search) {
      list = list.filter(item => 
        item.name.toLowerCase().includes(search) || 
        item.model.toLowerCase().includes(search) || 
        item.ipAddress.toLowerCase().includes(search) || 
        item.macAddress.toLowerCase().includes(search)
      );
    }

    if (status !== 'All') {
      list = list.filter(item => item.status === status);
    }

    return list;
  });

  protected readonly fixedReaderStats = computed(() => {
    const list = this.fixedReadersList();
    const total = list.length;
    const online = list.filter(r => r.status === 'Online').length;
    const degraded = list.filter(r => r.status === 'Degraded').length;
    const offline = list.filter(r => r.status === 'Offline').length;

    return { total, online, degraded, offline };
  });

  protected rebootReader(id: string) {
    alert(`Initiating reboot command for reader ${id}... Please wait.`);
    this.fixedReadersList.set(this.fixedReadersList().map(r => {
      if (r.id === id) {
        return { ...r, status: 'Rebooting', lastActive: 'Rebooting...' };
      }
      return r;
    }));
    setTimeout(() => {
      const reader = this.fixedReadersList().find(r => r.id === id);
      if (reader) {
        const payload = {
          name: reader.name,
          ipAddress: reader.ipAddress,
          port: 5084,
          antennaCount: reader.antennas.length,
          powerDbm: parseInt(reader.powerLevel) || 30,
          siteId: 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c91', // default site Pune DC
          model: reader.model,
          status: 'Online'
        };
        this.apiService.updateReader(id, payload).subscribe({
          next: () => this.loadAllApiData(),
          error: (err) => console.error('Error rebooting reader', err)
        });
      }
    }, 4000);
  }

  // Handheld Sessions State
  protected readonly handheldSearchQuery = signal<string>('');
  protected readonly handheldStatusFilter = signal<string>('All');

  protected readonly handheldSessionsList = signal<any[]>([]);

  protected fetchHandheldSessions() {
    this.apiService.getScanSessions(1, 200).subscribe({
      next: (res) => {
        const body = res.body || res || [];
        if (Array.isArray(body)) {
          const handheldSessions = body;
          this.handheldSessionsList.set(handheldSessions.map((s: any) => {
            const date = new Date(s.startTime);
            const duration = s.endTime 
              ? `${Math.max(1, Math.round((new Date(s.endTime).getTime() - date.getTime()) / 60000))} mins`
              : 'Active';
            
            let opName = 'Operator';
            if (s.sessionName && s.sessionName.includes(' – ')) {
              opName = s.sessionName.split(' – ')[0].trim();
            } else if (s.handheldDeviceName) {
              opName = s.handheldDeviceName.replace('Handheld ', '');
            } else if (s.sessionName) {
              opName = s.sessionName;
            }

            return {
              id: s.id,
              operator: opName,
              model: s.handheldDeviceName || 'C72 Handheld Reader',
              type: s.sessionName && s.sessionName.includes('Inventory') ? 'Inventory' : 'Scanning',
              startTime: date.toLocaleString(),
              duration: duration,
              scannedTags: s.scanEvents ? s.scanEvents.length : 0,
              discrepancies: 0,
              status: s.isRunning ? 'In Progress' : 'Synced'
            };
          }));
        }
      },
      error: (err) => console.error('Failed to fetch handheld sessions', err)
    });
  }

  protected fetchRfidEvents() {
    if (!this.isLoggedIn()) return;
    this.http.get<any>(`${environment.apiUrl}/movements?page=1&size=200`).subscribe({
      next: (res) => {
        const body = res.body || res || [];
        const movements = Array.isArray(body) ? body : (body.items ?? []);
        if (Array.isArray(movements)) {
          this.rfidEventsList.set(movements.map((m: any) => {
            const date = new Date(m.movementDate);
            const source = m.handheldDeviceName ? 'Scan from Handheld' : (m.readerName ? 'Scanned through Fixed Reader' : 'System');
            const location = m.remarks || m.destinationLocationName || 'Pune DC';
            return {
              id: m.id,
              severity: 'Info',
              time: date.toLocaleTimeString(),
              date: date.toLocaleDateString(),
              eventType: m.movementType || 'Asset Scan',
              message: `Asset ${m.assetName} (${m.assetNumber}) moved to ${location}`,
              reader: source,
              antenna: '1',
              rssi: '-58 dBm'
            };
          }));
        }
      },
      error: (err) => console.error('Failed to fetch asset movements for RFID events', err)
    });
  }

  protected readonly filteredHandheldSessionsList = computed(() => {
    const search = this.handheldSearchQuery().toLowerCase().trim();
    const status = this.handheldStatusFilter();
    let list = this.handheldSessionsList();

    if (search) {
      list = list.filter(item => 
        item.operator.toLowerCase().includes(search) || 
        item.model.toLowerCase().includes(search) || 
        item.type.toLowerCase().includes(search)
      );
    }

    if (status !== 'All') {
      list = list.filter(item => item.status === status);
    }

    return list;
  });

  protected readonly handheldStats = computed(() => {
    const list = this.handheldSessionsList();
    const total = list.length;
    const active = list.filter(s => s.status === 'In Progress').length;
    const completed = list.filter(s => s.status === 'Completed' || s.status === 'Synced').length;
    const discrepancies = list.reduce((sum, s) => sum + s.discrepancies, 0);

    return { total, active, completed, discrepancies };
  });

  protected stopHandheldSession(id: string) {
    if (confirm(`Stop scanning session ${id}?`)) {
      this.apiService.endScanSession(id).subscribe({
        next: () => {
          this.loadAllApiData();
        },
        error: (err) => console.error('Failed to end scan session', err)
      });
    }
  }

  // RFID Events State
  protected readonly rfidEventsSearchQuery = signal<string>('');
  protected readonly rfidEventsTypeFilter = signal<string>('All');

  protected readonly rfidEventsList = signal<any[]>([]);

  protected readonly filteredRfidEventsList = computed(() => {
    const search = this.rfidEventsSearchQuery().toLowerCase().trim();
    const type = this.rfidEventsTypeFilter();
    let list = this.rfidEventsList();

    if (search) {
      list = list.filter(item => 
        item.message.toLowerCase().includes(search) || 
        item.reader.toLowerCase().includes(search) || 
        item.eventType.toLowerCase().includes(search)
      );
    }

    if (type !== 'All') {
      list = list.filter(item => item.severity === type || item.eventType === type);
    }

    return list;
  });

  protected clearRfidEvents() {
    if (confirm('Are you sure you want to clear all raw event logs?')) {
      this.rfidEventsList.set([]);
    }
  }

  // GPS Tracking State
  protected readonly gpsSearchQuery = signal<string>('');
  protected readonly gpsStatusFilter = signal<string>('All');
  protected readonly gpsTypeFilter = signal<string>('All');
  protected readonly showGpsFilterModal = signal<boolean>(false);
  protected readonly gpsShowGeofences = signal<boolean>(true);
  protected readonly gpsAutoRefresh = signal<boolean>(true);
  protected readonly gpsRefreshInterval = signal<number>(10);
  protected readonly gpsSelectedAsset = signal<GPSAsset | null>(null);
  protected readonly gpsDetailTab = signal<'overview' | 'route' | 'rfid' | 'trips'>('overview');

  // GPS Route Playback state
  protected readonly isGpsPlaybackActive = signal<boolean>(false);
  protected readonly isGpsPlaybackPlaying = signal<boolean>(false);
  protected readonly gpsPlaybackSpeed = signal<number>(1);
  protected readonly gpsPlaybackProgress = signal<number>(0);
  protected readonly gpsPlaybackIndex = signal<number>(0);
  protected readonly gpsPlaybackTotalPoints = signal<number>(0);
  protected readonly gpsPlaybackCurrentTime = signal<string>('—');
  private gpsPlaybackTimer: any = null;
  private gpsPlaybackTrail: any[] = [];

  // Geofence Breach Toasts state
  protected readonly geofenceAlerts = signal<Array<{
    id: string;
    assetId: string;
    assetName: string;
    zone: string;
    speed: number;
    time: string;
    severity: 'warning' | 'danger';
  }>>([
    {
      id: 'ALT-INITIAL-1',
      assetId: '16512010049',
      assetName: 'Toyota Forklift Model-X (16512010049)',
      zone: 'Transit Route Highway',
      speed: 58,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      severity: 'danger'
    }
  ]);

  protected dismissGeofenceAlert(id: string) {
    this.geofenceAlerts.update(alerts => alerts.filter(a => a.id !== id));
  }

  protected locateGeofenceBreachOnMap(alertItem: any) {
    const asset = this.filteredGpsAssets().find(a => a.id === alertItem.assetId || a.name.includes(alertItem.assetName));
    if (asset) {
      this.selectGpsAsset(asset);
      this.centerOnSelectedAsset();
    }
  }

  protected toggleGpsPlayback() {
    const next = !this.isGpsPlaybackActive();
    this.isGpsPlaybackActive.set(next);
    if (next) {
      this.initGpsPlayback();
    } else {
      this.stopGpsPlayback();
    }
  }

  protected initGpsPlayback() {
    const history = this.gpsAssetHistory();
    const sel = this.gpsSelectedAsset();
    const baseLat = sel?.latitude || 18.5965;
    const baseLon = sel?.longitude || 73.8272;

    if (!history || history.length === 0) {
      const mockPoints = [];
      for (let i = 0; i <= 25; i++) {
        const time = new Date(Date.now() - (25 - i) * 120000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        mockPoints.push({
          lat: baseLat - 0.0060 + (i * 0.00030),
          lon: baseLon - 0.0050 + (i * 0.00025),
          time: time,
          speed: Math.round(12 + Math.sin(i * 0.5) * 15),
          zone: i > 12 ? 'Transit Route' : 'Main Yard'
        });
      }
      this.gpsPlaybackTrail = mockPoints;
    } else {
      this.gpsPlaybackTrail = history;
    }

    this.gpsPlaybackTotalPoints.set(this.gpsPlaybackTrail.length);
    this.gpsPlaybackIndex.set(0);
    this.gpsPlaybackProgress.set(0);
    this.updateGpsPlaybackFrame(0);
  }

  protected playGpsPlayback() {
    if (this.isGpsPlaybackPlaying()) return;
    this.isGpsPlaybackPlaying.set(true);
    this.startGpsPlaybackTimer();
  }

  protected pauseGpsPlayback() {
    this.isGpsPlaybackPlaying.set(false);
    if (this.gpsPlaybackTimer) {
      clearInterval(this.gpsPlaybackTimer);
      this.gpsPlaybackTimer = null;
    }
  }

  protected stopGpsPlayback() {
    this.pauseGpsPlayback();
    this.gpsPlaybackIndex.set(0);
    this.gpsPlaybackProgress.set(0);
    this.updateGpsPlaybackFrame(0);
  }

  protected seekGpsPlayback(event: Event) {
    const target = event.target as HTMLInputElement;
    const progress = parseFloat(target.value);
    this.gpsPlaybackProgress.set(progress);
    const total = this.gpsPlaybackTotalPoints();
    if (total === 0) return;
    const idx = Math.min(total - 1, Math.floor((progress / 100) * total));
    this.gpsPlaybackIndex.set(idx);
    this.updateGpsPlaybackFrame(idx);
  }

  protected setGpsPlaybackSpeed(speed: number) {
    this.gpsPlaybackSpeed.set(speed);
    if (this.isGpsPlaybackPlaying()) {
      this.pauseGpsPlayback();
      this.playGpsPlayback();
    }
  }

  private startGpsPlaybackTimer() {
    if (this.gpsPlaybackTimer) clearInterval(this.gpsPlaybackTimer);
    const intervalMs = Math.round(1000 / this.gpsPlaybackSpeed());
    this.gpsPlaybackTimer = setInterval(() => {
      let nextIdx = this.gpsPlaybackIndex() + 1;
      const total = this.gpsPlaybackTotalPoints();
      if (nextIdx >= total) {
        this.pauseGpsPlayback();
        nextIdx = total - 1;
      }
      this.gpsPlaybackIndex.set(nextIdx);
      const pct = total > 1 ? (nextIdx / (total - 1)) * 100 : 100;
      this.gpsPlaybackProgress.set(pct);
      this.updateGpsPlaybackFrame(nextIdx);
    }, intervalMs);
  }

  private updateGpsPlaybackFrame(idx: number) {
    if (!this.gpsPlaybackTrail || this.gpsPlaybackTrail.length === 0) return;
    const pt = this.gpsPlaybackTrail[idx];
    if (!pt) return;

    const lat = parseFloat(pt.lat || pt.Lat || pt.latitude);
    const lon = parseFloat(pt.lon || pt.Lon || pt.longitude);
    const speed = parseFloat(pt.speed || pt.Speed || 0);
    const time = pt.time || pt.Time || new Date().toLocaleTimeString();

    this.gpsPlaybackCurrentTime.set(time);

    const currentSel = this.gpsSelectedAsset();
    if (currentSel) {
      const updatedSel = {
        ...currentSel,
        latitude: lat,
        longitude: lon,
        speed: speed,
        lastGpsPing: time
      };
      this.gpsSelectedAsset.set(updatedSel);
    }

    if (this.satelliteMap && !isNaN(lat) && !isNaN(lon)) {
      this.updateSatelliteMarkers();
      this.satelliteMap.panTo([lat, lon], { animate: true, duration: 0.3 });
    }
  }

  protected resetGpsFilters() {
    this.gpsSearchQuery.set('');
    this.gpsStatusFilter.set('All');
    this.gpsTypeFilter.set('All');
    this.showGpsFilterModal.set(false);
  }

  // Map zoom and pan state
  protected readonly gpsMapZoom = signal<number>(1);
  protected readonly gpsMapPanX = signal<number>(0);
  protected readonly gpsMapPanY = signal<number>(0);
  protected readonly gpsMapFullscreen = signal<boolean>(false);
  protected readonly gpsMapTheme = signal<'standard' | 'dark'>('standard');
  protected readonly isMapDragging = signal<boolean>(false);

  private dragStartX = 0;
  private dragStartY = 0;
  private panStartX = 0;
  private panStartY = 0;

  protected zoomMapIn() {
    if (this.satelliteMap) {
      this.satelliteMap.zoomIn();
    } else {
      const next = Math.min(3, this.gpsMapZoom() + 0.25);
      this.gpsMapZoom.set(next);
      if (next === 1) {
        this.gpsMapPanX.set(0);
        this.gpsMapPanY.set(0);
      }
    }
  }

  protected zoomMapOut() {
    if (this.satelliteMap) {
      this.satelliteMap.zoomOut();
    } else {
      const next = Math.max(1, this.gpsMapZoom() - 0.25);
      this.gpsMapZoom.set(next);
      if (next === 1) {
        this.gpsMapPanX.set(0);
        this.gpsMapPanY.set(0);
      }
    }
  }

  protected toggleMapLayers() {
    const layers: ('satellite' | 'hybrid' | 'street')[] = ['satellite', 'hybrid', 'street'];
    const current = this.gpsMapLayer();
    const nextIndex = (layers.indexOf(current) + 1) % layers.length;
    this.switchMapLayer(layers[nextIndex]);
  }

  protected toggleMapFullscreen() {
    const mapElem = document.getElementById('leaflet-satellite-map');
    if (mapElem) {
      const parent = mapElem.parentElement || mapElem;
      if (!document.fullscreenElement) {
        if (parent.requestFullscreen) {
          parent.requestFullscreen().catch(err => console.warn(err));
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen().catch(err => console.warn(err));
        }
      }
      setTimeout(() => {
        if (this.satelliteMap) {
          this.satelliteMap.invalidateSize(true);
        }
      }, 250);
    } else {
      this.gpsMapFullscreen.set(!this.gpsMapFullscreen());
    }
  }

  protected onMapMouseDown(event: MouseEvent) {
    if (this.gpsMapZoom() <= 1) return;
    this.isMapDragging.set(true);
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.panStartX = this.gpsMapPanX();
    this.panStartY = this.gpsMapPanY();
  }

  protected onMapMouseMove(event: MouseEvent) {
    if (!this.isMapDragging()) return;
    const dx = event.clientX - this.dragStartX;
    const dy = event.clientY - this.dragStartY;
    this.gpsMapPanX.set(this.panStartX + dx);
    this.gpsMapPanY.set(this.panStartY + dy);
  }

  protected onMapMouseUp() {
    this.isMapDragging.set(false);
  }

  protected onMapTouchStart(event: TouchEvent) {
    if (this.gpsMapZoom() <= 1 || event.touches.length === 0) return;
    this.isMapDragging.set(true);
    this.dragStartX = event.touches[0].clientX;
    this.dragStartY = event.touches[0].clientY;
    this.panStartX = this.gpsMapPanX();
    this.panStartY = this.gpsMapPanY();
  }

  protected onMapTouchMove(event: TouchEvent) {
    if (!this.isMapDragging() || event.touches.length === 0) return;
    const dx = event.touches[0].clientX - this.dragStartX;
    const dy = event.touches[0].clientY - this.dragStartY;
    this.gpsMapPanX.set(this.panStartX + dx);
    this.gpsMapPanY.set(this.panStartY + dy);
  }

  // Stats signals
  protected readonly gpsTotalAssets = signal<number>(128);
  protected readonly gpsMovingCount = signal<number>(46);
  protected readonly gpsIdleCount = signal<number>(32);
  protected readonly gpsStoppedCount = signal<number>(28);
  protected readonly gpsLowBatteryCount = signal<number>(6);
  protected readonly gpsExceptionCount = signal<number>(4);
  protected readonly gpsOfflineCount = signal<number>(12);

  protected readonly gpsAssets = signal<GPSAsset[]>([]);

  // Computed signals for GPS asset type counts
  protected readonly gpsVehicleCount = computed(() => this.siteFilteredGpsAssets().filter(a => a.type === 'Vehicle').length);
  protected readonly gpsForkliftCount = computed(() => this.siteFilteredGpsAssets().filter(a => a.type === 'Forklift').length);
  protected readonly gpsPalletBinCount = computed(() => this.siteFilteredGpsAssets().filter(a => a.type === 'Pallet/Bin').length);
  protected readonly gpsContainerCount = computed(() => this.siteFilteredGpsAssets().filter(a => a.type === 'Container').length);
  protected readonly gpsToolEquipCount = computed(() => this.siteFilteredGpsAssets().filter(a => a.type === 'Tool/Equipment').length);
  protected readonly gpsMobileEquipCount = computed(() => this.siteFilteredGpsAssets().filter(a => a.type === 'Mobile Equipment').length);

  protected readonly gpsTransitRouteCount = computed(() => this.siteFilteredGpsAssets().filter(a => a.currentZone === 'Transit Route').length || 1);
  protected readonly gpsYardCount = computed(() => this.siteFilteredGpsAssets().filter(a => a.currentZone.includes('Yard')).length || 2);
  protected readonly gpsDockCount = computed(() => this.siteFilteredGpsAssets().filter(a => a.currentZone.includes('Dock')).length || 2);

  // GPS asset history list signal
  protected readonly gpsAssetHistory = signal<any[]>([]);

  // GPS selected date signal (defaults to current local date YYYY-MM-DD)
  protected readonly gpsSelectedDate = signal<string>(new Date().toLocaleDateString('en-CA'));

  // GPS selected asset trail points (coordinates on map)
  protected readonly gpsSelectedTrail = computed(() => {
    const history = this.gpsAssetHistory();
    if (!history || history.length === 0) return [];
    
    return history.map(h => {
      const latRaw = h.lat !== undefined ? h.lat : (h.Lat !== undefined ? h.Lat : (h.latitude !== undefined ? h.latitude : h.Latitude));
      const lonRaw = h.lon !== undefined ? h.lon : (h.Lon !== undefined ? h.Lon : (h.longitude !== undefined ? h.longitude : h.Longitude));
      const lat = parseFloat(latRaw || '0');
      const lon = parseFloat(lonRaw || '0');
      return {
        x: Math.min(100, Math.max(0, Math.round(((lon - 73.8540) / (73.8600 - 73.8540)) * 100))),
        y: Math.min(100, Math.max(0, Math.round(((18.6230 - lat) / (18.6230 - 18.6180)) * 100)))
      };
    });
  });

  // GPS RFID reads for selected asset (derived from global events or mock data)
  protected readonly gpsSelectedRfidReads = computed(() => {
    const sel = this.gpsSelectedAsset();
    if (!sel) return [];
    
    // Find the linked asset for the selected GPS asset
    const linkedAsset = this.assets().find(a => a.gpsId === sel.id);
    if (!linkedAsset || !linkedAsset.rfidTag || linkedAsset.rfidTag === '—') return [];

    // Filter real scan events matching this asset's RFID tag
    return this.scanEventsList()
      .filter(evt => evt.epc === linkedAsset.rfidTag)
      .map(evt => ({
        time: evt.time,
        reader: evt.source,
        zone: evt.antenna || 'Zone A',
        rssi: evt.rssi,
        epc: evt.epc
      }));
  });

  // GPS trips for selected asset
  protected readonly gpsSelectedTrips = computed(() => {
    const sel = this.gpsSelectedAsset();
    if (!sel) return [];
    
    const history = this.gpsAssetHistory();
    if (!history || history.length === 0) return [];
    
    const trips: any[] = [];
    let currentTrip: any = null;
    let tripCounter = 1;
    
    for (let i = 0; i < history.length; i++) {
      const pt = history[i];
      const speed = parseFloat(pt.speed) || 0;
      const ptTime = new Date(pt.gpsTime);
      
      if (speed > 0) {
        if (!currentTrip) {
          currentTrip = {
            tripId: `TRP-${sel.id}-${1000 + tripCounter++}`,
            start: ptTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
            end: 'In Progress',
            from: 'Main Yard',
            to: 'Transit Route',
            startTimeMs: ptTime.getTime(),
            points: [pt],
            maxSpeed: speed,
            sumSpeed: speed
          };
        } else {
          currentTrip.points.push(pt);
          if (speed > currentTrip.maxSpeed) currentTrip.maxSpeed = speed;
          currentTrip.sumSpeed += speed;
        }
      } else {
        if (currentTrip) {
          // End the trip
          const endTime = ptTime;
          currentTrip.end = endTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
          const durationMs = endTime.getTime() - currentTrip.startTimeMs;
          const durationMins = Math.round(durationMs / 60000);
          const durationStr = durationMins >= 60 
            ? `${Math.floor(durationMins / 60)}h ${durationMins % 60}m`
            : `${durationMins}m`;
            
          // Estimate distance: average speed * duration
          const avgSpeed = currentTrip.sumSpeed / currentTrip.points.length;
          const dist = ((avgSpeed * (durationMs / 3600000))).toFixed(1);
          
          currentTrip.distance = `${dist} km`;
          currentTrip.duration = durationStr;
          currentTrip.status = 'Completed';
          currentTrip.avgSpeed = `${Math.round(avgSpeed)} km/h`;
          
          trips.push(currentTrip);
          currentTrip = null;
        }
      }
    }
    
    if (currentTrip) {
      // Add the final ongoing trip
      const now = new Date();
      const durationMs = now.getTime() - currentTrip.startTimeMs;
      const durationMins = Math.round(durationMs / 60000);
      const avgSpeed = currentTrip.sumSpeed / currentTrip.points.length;
      const dist = ((avgSpeed * (durationMs / 3600000))).toFixed(1);
      
      currentTrip.distance = `${dist} km`;
      currentTrip.duration = durationMins >= 60 
        ? `${Math.floor(durationMins / 60)}h ${durationMins % 60}m`
        : `${durationMins}m`;
      currentTrip.status = 'Active';
      currentTrip.avgSpeed = `${Math.round(avgSpeed)} km/h`;
      trips.push(currentTrip);
    }
    
    return trips;
  });

  // GPS Route points for selected asset
  protected readonly gpsSelectedRoute = computed(() => {
    const sel = this.gpsSelectedAsset();
    if (!sel) return [];
    
    const history = this.gpsAssetHistory();
    if (history && history.length > 0) {
      return history.map((h, i) => {
        const latRaw = h.lat !== undefined ? h.lat : (h.Lat !== undefined ? h.Lat : (h.latitude !== undefined ? h.latitude : h.Latitude));
        const lonRaw = h.lon !== undefined ? h.lon : (h.Lon !== undefined ? h.Lon : (h.longitude !== undefined ? h.longitude : h.Longitude));
        const speedRaw = h.speed !== undefined ? h.speed : (h.Speed !== undefined ? h.Speed : 0);
        const headingRaw = h.direction !== undefined ? h.direction : (h.Direction !== undefined ? h.Direction : (h.heading !== undefined ? h.heading : h.Heading));
        
        let rawTime = h.gpsTime || h.GpsTime || h.timestamp || h.Timestamp || h.time || h.Time;
        let timeStr = '-';
        if (rawTime) {
          const d = new Date(typeof rawTime === 'number' ? rawTime : rawTime);
          if (!isNaN(d.getTime())) {
            timeStr = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
          } else {
            timeStr = String(rawTime);
          }
        }
        
        const speed = parseFloat(speedRaw) || 0;
        const heading = headingRaw !== undefined ? headingRaw : 0;
        const lat = parseFloat(latRaw || 0);
        const lon = parseFloat(lonRaw || 0);

        return {
          seq: i + 1,
          time: timeStr,
          zone: speed > 0 ? 'Transit Route' : (h.Address || h.address || 'Main Yard'),
          details: `Speed: ${speed} km/h, Heading: ${heading}°`,
          type: speed > 0 ? 'moving' as const : 'idle' as const,
          lat: lat.toFixed(6),
          lon: lon.toFixed(6),
          speed: speed
        };
      });
    }
    
    // Fallback to current location if no history
    return [{
      seq: 1,
      time: sel.lastGpsPing,
      zone: sel.currentZone,
      details: `Current position telemetry: Speed ${sel.speed}km/h`,
      type: sel.speed > 0 ? 'moving' as const : 'idle' as const,
      lat: sel.latitude.toFixed(6),
      lon: sel.longitude.toFixed(6),
      speed: sel.speed
    }];
  });

  protected readonly filteredGpsAssets = computed(() => {
    let list = this.gpsAssets();
    const q = this.gpsSearchQuery().toLowerCase();
    const status = this.gpsStatusFilter();
    const type = this.gpsTypeFilter();
    const site = this.selectedSite();
    const op = this.activeOperation();

    const activeGpsIds = this.assets()
      .map(asset => asset.gpsId)
      .filter(gpsId => gpsId && gpsId !== '—');

    const registeredGpsIds = this.gpsDevicesPool().map(g => g.imei);
    list = list.filter(a => 
      activeGpsIds.includes(a.id) || 
      registeredGpsIds.includes(a.id) || 
      true // Ensure all live tracking devices are visible
    );

    if (q) {
      list = list.filter(a =>
        a.id.toLowerCase().includes(q) ||
        a.name.toLowerCase().includes(q) ||
        a.tag.toLowerCase().includes(q) ||
        (a.operator && a.operator.toLowerCase().includes(q))
      );
    }

    if (status !== 'All') {
      if (status === 'Low Battery') {
        list = list.filter(a => a.battery < 25);
      } else if (status === 'Exception') {
        list = list.filter(a => a.exception !== '');
      } else {
        list = list.filter(a => {
          const firstEvent = a.timeline[0];
          if (!firstEvent) return false;
          if (status === 'Moving') return a.speed > 0;
          if (status === 'Idle') return firstEvent.type === 'idle';
          if (status === 'Stopped') return a.speed === 0 && firstEvent.type === 'stopped';
          if (status === 'Offline') return a.status.toLowerCase() === 'offline';
          return true;
        });
      }
    }

    if (type !== 'All') {
      list = list.filter(a => a.type === type);
    }

    if (site !== 'All Sites') {
      list = list.filter(a => a.site === site);
    }

    if (op !== 'All Operations') {
      list = list.filter(a => {
        const zone = a.currentZone.toLowerCase();
        if (op === 'Warehouse') {
          return zone.includes('yard') || zone.includes('dock') || zone.includes('receiving');
        } else if (op === 'Manufacturing') {
          return zone.includes('wip') || zone.includes('raw material');
        } else if (op === 'Distribution') {
          return zone.includes('finished') || zone.includes('dispatch') || zone.includes('gate');
        }
        return true;
      });
    }

    return list;
  });

  // Asset Master State & Data
  protected readonly assets = signal<Asset[]>([]);

  // Base site-filtered list of assets (respects selectedSite and activeOperation)
  protected readonly siteFilteredAssets = computed(() => {
    const globalSite = this.selectedSite();
    const op = this.activeOperation();
    let list = this.assets();
    
    list = list.filter(asset => this.siteMatchesFilter(asset.site));
    
    if (op !== 'All Operations') {
      list = list.filter(asset => {
        if (op === 'Warehouse') return !!(asset.site?.includes('DC') || asset.site?.includes('Warehouse'));
        if (op === 'Manufacturing') return !!asset.site?.includes('Plant');
        if (op === 'Distribution') return !!asset.site?.includes('Hub');
        return true;
      });
    }
    return list;
  });

  // Base site-filtered list of GPS assets (respects selectedSite and activeOperation)
  protected readonly siteFilteredGpsAssets = computed(() => {
    let list = this.gpsAssets();
    const site = this.selectedSite();
    const op = this.activeOperation();
    
    list = list.filter(a => this.siteMatchesFilter(a.site));
    
    if (op !== 'All Operations') {
      list = list.filter(a => {
        const zone = a.currentZone.toLowerCase();
        if (op === 'Warehouse') {
          return zone.includes('yard') || zone.includes('dock') || zone.includes('receiving');
        } else if (op === 'Manufacturing') {
          return zone.includes('wip') || zone.includes('raw material');
        } else if (op === 'Distribution') {
          return zone.includes('finished') || zone.includes('dispatch') || zone.includes('gate');
        }
        return true;
      });
    }
    return list;
  });

  // Base site-only filtered assets
  protected readonly siteOnlyFilteredAssets = computed(() => {
    const globalSite = this.selectedSite();
    let list = this.assets();
    list = list.filter(asset => this.siteMatchesFilter(asset.site));
    return list;
  });

  protected readonly totalInventoryCount = computed(() => this.siteFilteredAssets().length);
  protected readonly serializedAssetsCount = computed(() => this.siteFilteredAssets().filter(a => a.assetType === 'Serialized').length);
  protected readonly returnableAssetsCount = computed(() => this.siteFilteredAssets().filter(a => a.assetType === 'Returnable' || a.category?.toLowerCase().includes('returnable')).length);
  protected readonly gpsEnabledAssetsCount = computed(() => this.siteFilteredGpsAssets().length);

  protected readonly warehouseAssetsCount = computed(() => this.siteOnlyFilteredAssets().filter(a => a.site?.includes('DC') || a.site?.includes('Warehouse')).length);
  protected readonly manufacturingAssetsCount = computed(() => this.siteOnlyFilteredAssets().filter(a => a.site?.includes('Plant')).length);
  protected readonly distributionCenterAssetsCount = computed(() => this.siteOnlyFilteredAssets().filter(a => a.site?.includes('Hub')).length);

  protected readonly inUseAssetsCount = computed(() => this.siteFilteredAssets().filter(a => a.status === 'In Use').length);
  protected readonly availableAssetsCount = computed(() => this.siteFilteredAssets().filter(a => a.status === 'Available').length);
  protected readonly checkedOutAssetsCount = computed(() => this.siteFilteredAssets().filter(a => a.status === 'Checked Out' || a.status === 'Assigned' || a.status === 'In Use').length);
  protected readonly underMaintenanceAssetsCount = computed(() => this.siteFilteredAssets().filter(a => a.status === 'Under Maintenance').length);
  protected readonly overdueAssetsCount = computed(() => this.siteFilteredAssets().filter(a => a.status === 'Overdue' || (a.nextMaintenance && new Date(a.nextMaintenance) < new Date())).length);

  // Devam dashboard — category breakdown
  protected readonly devamCategoryBreakdown = computed(() => {
    const assets = this.siteFilteredAssets();
    const total = assets.length;
    const catMap = new Map<string, number>();
    assets.forEach(a => {
      const cat = a.category || a.assetType || 'Others';
      catMap.set(cat, (catMap.get(cat) || 0) + 1);
    });
    const sorted = Array.from(catMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({
        name,
        count,
        pct: total > 0 ? Math.round((count / total) * 100) : 0
      }));
    const colors = ['#3b82f6','#22c55e','#a855f7','#f59e0b','#ef4444'];
    return sorted.map((item, i) => ({ ...item, color: colors[i] || '#64748b' }));
  });

  // Devam dashboard — top 5 assets list
  protected readonly devamTopAssets = computed(() =>
    this.siteFilteredAssets().slice(0, 5)
  );

  // Devam dashboard — recent transactions from checkoutRecords
  protected readonly devamRecentTransactions = computed(() => {
    const site = this.selectedSite();
    let records = this.checkoutRecords();
    if (site && site !== 'All Sites') {
      records = records.filter(r => !r.site || r.site === site || r.site.toLowerCase().includes(site.toLowerCase()));
    }
    return records.slice(0, 5).map(r => ({
      type: r.operation || (r.status === 'Active' ? 'Check Out' : 'Check In'),
      assetName: r.assetName || r.asset || '—',
      person: r.entity || r.custodian || '—',
      time: r.date || r.timestamp || '—'
    }));
  });

  // Devam Inventory View — filter signals
  protected readonly devamInvSearch = signal<string>('');
  protected readonly devamInvCategoryFilter = signal<string>('All Categories');
  protected readonly devamInvStatusFilter = signal<string>('All Status');

  protected readonly devamInvCategories = computed(() => {
    const cats = new Set<string>();
    this.siteFilteredAssets().forEach(a => {
      if (a.category || a.assetType) cats.add((a.category || a.assetType)!);
    });
    return ['All Categories', ...Array.from(cats)];
  });

  protected readonly devamFilteredAssets = computed(() => {
    const search = this.devamInvSearch().toLowerCase().trim();
    const cat = this.devamInvCategoryFilter();
    const status = this.devamInvStatusFilter();
    let list = this.siteFilteredAssets();
    if (cat !== 'All Categories') list = list.filter(a => (a.category || a.assetType) === cat);
    if (status !== 'All Status') list = list.filter(a => a.status === status);
    if (search) list = list.filter(a =>
      (a.name || '').toLowerCase().includes(search) ||
      (a.assetNumber || a.id || '').toLowerCase().includes(search) ||
      (a.category || a.assetType || '').toLowerCase().includes(search)
    );
    return list;
  });

  // Modal / Form state signals
  protected readonly isModalOpen = signal<boolean>(false);
  protected readonly modalMode = signal<'add' | 'edit'>('add');
  protected readonly modalAssetId = signal<string>('');
  protected readonly formAssetNumber = signal<string>('');
  protected readonly formName = signal<string>('');
  protected readonly formCategory = signal<string>('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d');
  protected readonly formRfid = signal<string>('');
  protected readonly formGps = signal<string>('');
  protected readonly formStatus = signal<string>('Available');
  protected readonly formSerialNumber = signal<string>('');
  protected readonly formQrCode = signal<string>('');
  protected readonly formGroup = signal<string>('');
  protected readonly formManufacturer = signal<string>('');
  protected readonly formModel = signal<string>('');
  protected readonly formPurchaseDate = signal<string>('');
  protected readonly formWarranty = signal<string>('');
  protected readonly formWarrantyProvider = signal<string>('');
  protected readonly formCustodian = signal<string>('');
  protected readonly formCustodianEmail = signal<string>('');
  protected readonly formDepartment = signal<string>('');
  protected readonly formIndustry = signal<string>('');
  protected readonly formBusinessUnit = signal<string>('');
  protected readonly formSiteId = signal<string>('');
  protected readonly formZoneId = signal<string>('');
  protected readonly formWarehouseId = signal<string>('');
  protected readonly formAssetType = signal<string>('');

  protected readonly isCategoryModalOpen = signal<boolean>(false);
  protected readonly formCategoryName = signal<string>('');
  protected readonly formCategoryDescription = signal<string>('');

  protected readonly isGroupModalOpen = signal<boolean>(false);
  protected readonly formGroupName = signal<string>('');
  protected readonly formGroupCategory = signal<string>('');

  protected readonly customGroups = signal<{name: string, categoryName: string}[]>([]);
  protected readonly apiCategories = signal<any[]>([]);
  protected readonly categorySearchQuery = signal<string>('');

  protected readonly filteredApiCategories = computed(() => {
    const search = this.categorySearchQuery().toLowerCase().trim();
    const list = this.apiCategories();
    if (!search) return list;
    return list.filter(cat =>
      (cat.name || '').toLowerCase().includes(search) ||
      (cat.description || '').toLowerCase().includes(search)
    );
  });
  protected readonly apiSites = signal<any[]>([
    { id: '1', name: 'Pune DC', location: 'Pune, Maharashtra' },
    { id: '2', name: 'Mumbai Warehouse', location: 'Mumbai, Maharashtra' },
    { id: '3', name: 'Chennai Plant', location: 'Chennai, Tamil Nadu' },
    { id: '4', name: 'Bengaluru Hub', location: 'Bengaluru, Karnataka' },
    { id: '5', name: 'Delhi NCR', location: 'Delhi NCR' },
    { id: '6', name: 'Hyderabad DC', location: 'Hyderabad, Telangana' }
  ]);
  protected readonly apiWarehouses = signal<any[]>([]);
  protected readonly apiZones = signal<any[]>([]);
  protected readonly apiLocations = signal<any[]>([]);

  // Warehouses filtered by selected site
  protected readonly filteredWarehouses = computed(() => {
    const siteId = this.formSiteId();
    if (!siteId) return this.apiWarehouses();
    return this.apiWarehouses().filter(w => w.siteId === siteId);
  });

  // Zones filtered by selected warehouse
  protected readonly filteredZones = computed(() => {
    const warehouseId = this.formWarehouseId();
    if (!warehouseId) return this.apiZones();
    return this.apiZones().filter(z => z.warehouseId === warehouseId);
  });

  protected readonly isBulkTagsModalOpen = signal<boolean>(false);
  protected readonly formBulkTagsType = signal<'RFID' | 'Barcode' | 'GPS'>('RFID');
  protected readonly formBulkTagsText = signal<string>('');

  protected readonly rfidTagsPool = signal<any[]>([]);
  protected readonly barcodesPool = signal<any[]>([]);
  protected readonly gpsDevicesPool = signal<any[]>([]);

  protected readonly unassignedRfidTags = computed(() => {
    const currentAssetId = this.modalAssetId();
    return this.rfidTagsPool().filter(t => !t.assetId || t.assetId === currentAssetId);
  });

  protected readonly unassignedBarcodes = computed(() => {
    const currentAssetId = this.modalAssetId();
    return this.barcodesPool().filter(b => !b.assetId || b.assetId === currentAssetId);
  });

  protected readonly unassignedGpsDevices = computed(() => {
    const currentAssetId = this.modalAssetId();
    return this.gpsDevicesPool().filter(g => !g.assetId || g.assetId === currentAssetId);
  });

  private readonly fallbackMockAssets: any[] = [];

  protected readonly selectedAsset = signal<Asset | null>(null);
  protected readonly activeAssetTab = signal<string>('Overview');
  protected readonly activeAssetSite = signal<string>('All Assets');
  protected readonly activeAssetCategory = signal<string>('All Categories');
  protected readonly activeAssetStatus = signal<string>('');
  protected readonly assetSearchQuery = signal<string>('');
  protected readonly showAssetFilters = signal<boolean>(false);

  protected readonly filteredAssets = computed(() => {
    const q = this.assetSearchQuery().toLowerCase();
    const siteFilter = this.activeAssetSite();
    const categoryFilter = this.activeAssetCategory();
    const statusFilter = this.activeAssetStatus();
    const globalSite = this.selectedSite();
    let list = this.assets().map(asset => {
      if (asset.gpsId && asset.gpsId !== '—') {
        const matchingGps = this.gpsAssets().find(g => g.id === asset.gpsId);
        if (matchingGps) {
          return {
            ...asset,
            currentLocation: `Lat ${matchingGps.latitude.toFixed(6)}, Lon ${matchingGps.longitude.toFixed(6)}`,
            lastSeen: matchingGps.lastGpsPing || asset.lastSeen,
            zone: matchingGps.currentZone || asset.zone,
            lastReader: `GPS Tracker (${matchingGps.speed} km/h)`
          };
        }
      }
      return asset;
    });
    
    list = list.filter(asset => this.siteMatchesFilter(asset.site));

    // Set first matched asset as selected if current selection is not in filtered list
    const op = this.activeOperation();
    const res = list.filter(asset => {
      const matchesSearch = !q ||
        asset.id.toLowerCase().includes(q) ||
        asset.name.toLowerCase().includes(q) ||
        asset.rfidTag.toLowerCase().includes(q) ||
        asset.gpsId.toLowerCase().includes(q) ||
        (asset.category && asset.category.toLowerCase().includes(q)) ||
        (asset.custodian && asset.custodian.toLowerCase().includes(q));
      
      if (!matchesSearch) return false;
      
      if (categoryFilter !== 'All Categories' && asset.category !== categoryFilter) return false;

      if (siteFilter !== 'All Assets') {
        if (siteFilter === 'Warehouse' && !asset.site?.includes('DC') && !asset.site?.includes('Warehouse')) return false;
        if (siteFilter === 'Manufacturing' && !asset.site?.includes('Plant')) return false;
        if (siteFilter === 'Distribution Center' && !asset.site?.includes('Hub')) return false;
      }
      
      if (op !== 'All Operations') {
        if (op === 'Warehouse' && !asset.site?.includes('DC') && !asset.site?.includes('Warehouse')) return false;
        if (op === 'Manufacturing' && !asset.site?.includes('Plant')) return false;
        if (op === 'Distribution' && !asset.site?.includes('Hub')) return false;
      }
      
      if (statusFilter && asset.status !== statusFilter) return false;
      
      return true;
    });

    // Do NOT auto-select — detail panel only opens when user clicks an asset row
    // Keep current selection valid if it's still in the filtered list
    setTimeout(() => {
      const curr = this.selectedAsset();
      if (curr && !res.some(a => a.id === curr.id)) {
        // Current selection is no longer in filtered results — clear it
        this.selectedAsset.set(null);
      }
    }, 0);

    return res;
  });

  protected selectAsset(asset: Asset) {
    this.selectedAsset.set(asset);
    this.activeAssetTab.set('Overview');
  }

  protected selectAssetTab(tab: string) {
    this.activeAssetTab.set(tab);
  }

  protected selectAssetSite(site: string) {
    this.activeAssetSite.set(site);
  }

  protected selectAssetStatus(status: string) {
    this.activeAssetStatus.set(status);
  }

  protected clearAssetFilters() {
    this.activeAssetSite.set('All Assets');
    this.activeAssetStatus.set('');
    this.assetSearchQuery.set('');
  }

  protected onAssetSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.assetSearchQuery.set(value);
  }

  protected toggleAssetFilters() {
    this.showAssetFilters.set(!this.showAssetFilters());
  }

  protected exportAssetsToExcel() {
    if (!isPlatformBrowser(this.platformId)) return;

    const assetsList = this.filteredAssets();
    if (assetsList.length === 0) {
      window.alert('No assets to export.');
      return;
    }

    const headers = [
      'Asset ID',
      'Asset Number',
      'Asset Name',
      'RFID Tag EPC',
      'GPS Device ID',
      'Serial Number',
      'Category',
      'Status',
      'Site',
      'Zone',
      'Last Seen'
    ];

    const rows = assetsList.map(a => [
      a.id || '',
      a.assetNumber || '',
      a.name || '',
      a.rfidTag || '',
      a.gpsId || '',
      a.serialNumber || '',
      a.category || '',
      a.status || '',
      a.site || '',
      a.zone || '',
      a.lastSeen || ''
    ]);

    const sheetData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Assets');

    const wscols = headers.map(() => ({ wch: 20 }));
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, 'Asset_Master_Report.xlsx');
  }

  protected exportAuditReportToExcel() {
    if (!isPlatformBrowser(this.platformId)) return;

    const list = this.auditAssetsList();
    if (list.length === 0) {
      window.alert('No audit assets to export.');
      return;
    }

    const headers = [
      'Asset ID',
      'Asset Name',
      'Expected Zone',
      'Last Scanned Zone',
      'Audit Status',
      'Timestamp'
    ];

    const rows = list.map(item => [
      item.id || '',
      item.name || '',
      item.expectedZone || '',
      item.scannedZone || '',
      item.status || '',
      item.lastScanned || ''
    ]);

    const sheetData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Audit_Report');

    const wscols = headers.map(() => ({ wch: 20 }));
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, 'Audit_Session_Report.xlsx');
  }

  // Submenu custom states & helper methods
  protected readonly isBulkFileUploaded = signal<boolean>(false);
  protected readonly uploadedFileName = signal<string>('');
  protected readonly uploadedFileSize = signal<string>('');
  protected readonly parsedAssetsCount = signal<number>(0);
  protected readonly parsedAssets = signal<any[]>([]);
  protected readonly validAssetsCount = signal<number>(0);
  protected readonly warningAssetsCount = signal<number>(0);
  
  // Audit states
  protected readonly isAuditActive = signal<boolean>(false);
  protected readonly auditProgress = signal<number>(75);
  protected readonly auditedCount = signal<number>(6);
  protected readonly auditMatched = signal<number>(5);
  protected readonly auditDisplaced = signal<number>(1);
  protected readonly auditMissing = signal<number>(2);
  protected readonly auditLocation = signal<string>('Pune DC');
  protected readonly auditZone = signal<string>('Zone A');
  protected readonly auditReader = signal<string>('Fixed Gate 2 Reader');
  
  // Initial / active audit list
  protected readonly auditAssetsList = signal<any[]>([]);

  private auditInterval: any;
  
  protected startAudit() {
    if (this.isAuditActive()) return;
    this.isAuditActive.set(true);
    
    this.auditInterval = setInterval(() => {
      const currentList = this.auditAssetsList();
      const missingIndex = currentList.findIndex(a => a.status === 'Missing');
      if (missingIndex !== -1) {
        const updated = [...currentList];
        const item = { ...updated[missingIndex] };
        
        // 80% chance Matched, 20% chance Displaced
        const isMatched = Math.random() > 0.2;
        item.status = isMatched ? 'Matched' : 'Displaced';
        item.scannedZone = isMatched ? item.expectedZone : (item.expectedZone === 'Zone B' ? 'Zone A' : 'Zone B');
        item.lastScanned = 'Just now';
        
        updated[missingIndex] = item;
        this.auditAssetsList.set(updated);
        
        // Update counts
        this.auditedCount.update(c => c + 1);
        if (isMatched) {
          this.auditMatched.update(c => c + 1);
        } else {
          this.auditDisplaced.update(c => c + 1);
        }
        this.auditMissing.update(c => c - 1);
        
        const total = updated.length;
        const progress = Math.round((this.auditedCount() / total) * 100);
        this.auditProgress.set(progress);
      } else {
        this.stopAudit();
      }
    }, 3000);
  }
  
  protected stopAudit() {
    this.isAuditActive.set(false);
    if (this.auditInterval) {
      clearInterval(this.auditInterval);
    }
  }
  
  protected resetAudit() {
    this.stopAudit();
    this.auditProgress.set(0);
    this.auditedCount.set(0);
    this.auditMatched.set(0);
    this.auditDisplaced.set(0);
    
    const dbAssets = this.assets();
    this.auditMissing.set(dbAssets.length);
    this.auditAssetsList.set(dbAssets.map(a => ({
      id: a.assetNumber || a.id,
      name: a.name,
      expectedZone: a.zone || 'Zone A',
      scannedZone: '',
      status: 'Missing',
      lastScanned: '—'
    })));
  }
  
  protected onFileDropped(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer && event.dataTransfer.files.length > 0) {
      this.parseFile(event.dataTransfer.files[0]);
    }
  }

  protected onFileUploaded(event: Event) {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      this.parseFile(input.files[0]);
    }
  }

  private parseFile(file: File) {
    this.uploadedFileName.set(file.name);
    
    // Format file size
    const kb = (file.size / 1024).toFixed(1);
    this.uploadedFileSize.set(`${kb} KB`);

    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Parse to JSON array of objects
        const json: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        if (json.length === 0) {
          window.alert('The selected file is empty.');
          return;
        }

        const headers = json[0].map((h: any) => h?.toString().trim().toLowerCase());
        
        // Map columns
        const assetIdIdx = headers.indexOf('asset id');
        const nameIdx = headers.indexOf('asset name');
        const categoryIdx = headers.indexOf('category');
        const rfidIdx = headers.indexOf('rfid tag epc');
        const gpsIdx = headers.indexOf('gps device id');
        const siteIdx = headers.indexOf('site');
        const zoneIdx = headers.indexOf('zone');
        const statusIdx = headers.indexOf('status');
        const serialIdx = headers.indexOf('serial number');
        const custodianIdx = headers.indexOf('custodian');
        const descIdx = headers.indexOf('description');

        const list: any[] = [];
        let validCount = 0;
        let warningCount = 0;

        for (let i = 1; i < json.length; i++) {
          const row = json[i];
          if (!row || row.length === 0) continue;

          // Skip rows that don't have name and asset number
          const assetId = row[assetIdIdx] || row[0] || '';
          const name = row[nameIdx] || row[1] || '';
          if (!assetId && !name) continue;

          const category = row[categoryIdx] || '';
          const rfidTag = row[rfidIdx] || '';
          const gpsId = row[gpsIdx] || '';
          const site = row[siteIdx] || 'Pune DC';
          const zone = row[zoneIdx] || 'Zone A';
          const status = row[statusIdx] || 'Available';
          const serialNumber = row[serialIdx] || '';
          const custodian = row[custodianIdx] || '';
          const description = row[descIdx] || '';

          // Validate RFID Tag EPC: typically hex string of length 24
          const isRfidValid = !rfidTag || rfidTag === '-' || /^[0-9A-Fa-f]{24}$/.test(rfidTag.trim());

          if (isRfidValid) validCount++;
          else warningCount++;

          list.push({
            assetNumber: assetId.toString(),
            name: name.toString(),
            category: category.toString(),
            rfidTag: rfidTag.toString() === '-' ? '' : rfidTag.toString(),
            gpsId: gpsId.toString() === '-' ? '' : gpsId.toString(),
            site: site.toString(),
            zone: zone.toString(),
            status: status.toString(),
            serialNumber: serialNumber.toString(),
            custodian: custodian.toString(),
            description: description.toString(),
            isRfidValid: isRfidValid
          });
        }

        this.parsedAssets.set(list);
        this.parsedAssetsCount.set(list.length);
        this.validAssetsCount.set(validCount);
        this.warningAssetsCount.set(warningCount);
        this.isBulkFileUploaded.set(true);
      } catch (err) {
        console.error('Error parsing file', err);
        window.alert('Failed to parse file. Make sure it is a valid CSV or Excel template.');
      }
    };
    reader.readAsArrayBuffer(file);
  }
  
  protected cancelUpload() {
    this.isBulkFileUploaded.set(false);
    this.parsedAssets.set([]);
    this.parsedAssetsCount.set(0);
    this.validAssetsCount.set(0);
    this.warningAssetsCount.set(0);
  }

  protected proceedBulkImport() {
    if (!isPlatformBrowser(this.platformId)) return;

    const list = this.parsedAssets();
    if (list.length === 0) return;

    const currentUser = this.authService.currentUser();
    const currentSiteName = this.selectedSite();

    // Resolve current active site Guid for Devam / active organization fallback
    let defaultSiteObj = this.apiSites().find(s => s.name.toLowerCase() === currentSiteName.toLowerCase());
    if (!defaultSiteObj && currentUser?.siteId) {
      defaultSiteObj = this.apiSites().find(s => s.id?.toLowerCase() === currentUser.siteId.toLowerCase());
    }
    const defaultSiteId = defaultSiteObj ? defaultSiteObj.id : (currentUser?.siteId || 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c91');

    // Map fields to CreateAssetCommand matching the backend Command schema
    const commands = list.map(a => {
      // Find category Guid
      const matchedCat = this.apiCategories().find(c => c.name.toLowerCase() === a.category.toLowerCase());
      const catId = matchedCat ? matchedCat.id : 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d'; // fallback to Returnable Container id

      // Find site Guid matching uploaded row, or default to current user / organization siteId (Devam Site)
      const matchedSite = a.site && a.site !== '-' ? this.apiSites().find(s => s.name.toLowerCase() === a.site.toLowerCase()) : null;
      const siteId = matchedSite ? matchedSite.id : defaultSiteId;

      // Find zone Guid
      const matchedZone = this.apiZones().find(z => z.name.toLowerCase() === a.zone.toLowerCase());
      const zoneId = matchedZone ? matchedZone.id : null;

      // Status mapping: In Use => Assigned, Checked Out => InTransit, Under Maintenance => UnderMaintenance, etc.
      let statusEnum = 0; // Available
      if (a.status === 'In Use' || a.status === 'Assigned') statusEnum = 1; // Assigned
      else if (a.status === 'Checked Out' || a.status === 'InTransit') statusEnum = 2; // InTransit
      else if (a.status === 'Under Maintenance' || a.status === 'UnderMaintenance') statusEnum = 3; // UnderMaintenance
      else if (a.status === 'Retired') statusEnum = 4; // Retired

      return {
        assetNumber: a.assetNumber,
        name: a.name,
        assetCategoryId: catId,
        description: a.description,
        serialNumber: a.serialNumber,
        status: statusEnum,
        qrCode: a.assetNumber,
        group: 'Ungrouped',
        assetType: 'Physical',
        ownerDepartment: 'Operations',
        industry: 'Logistics',
        businessUnit: 'Supply Chain',
        currentCustodian: a.custodian,
        custodianEmail: a.custodian ? `${a.custodian.toLowerCase().replace(/\s+/g, '.')}@prosper.com` : '',
        model: '',
        warrantyProvider: '',
        purchaseDate: new Date(),
        purchasePrice: 0,
        warrantyExpiryDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        manufacturerId: null,
        siteId: siteId,
        zoneId: zoneId,
        warehouseId: null
      };
    });

    // Call API Bulk Create endpoint
    this.http.post(`${environment.apiUrl}/assets/bulk`, commands).subscribe({
      next: (res: any) => {
        // Automatically sync any provided RFID EPC tags or GPS IMEIs to backend pool
        list.forEach(a => {
          if (a.rfidTag && a.rfidTag !== '-' && a.rfidTag.trim().length > 0) {
            this.http.post(`${environment.apiUrl}/rfidtags`, {
              epcCode: a.rfidTag.trim(),
              assetId: null
            }).subscribe({ error: () => {} });
          }
          if (a.gpsId && a.gpsId !== '-' && a.gpsId.trim().length > 0) {
            this.http.post(`${environment.apiUrl}/gpsdevices`, {
              imei: a.gpsId.trim(),
              assetId: null
            }).subscribe({ error: () => {} });
          }
        });

        alert(`Successfully imported ${res.count || list.length} assets into PostgreSQL database for ${currentSiteName}! They are now live and synced for the Android application.`);
        this.isBulkFileUploaded.set(false);
        this.parsedAssets.set([]);
        this.fetchAssets(); // Refresh asset master grid and dashboard counts
      },
      error: (err) => {
        console.error('Failed to import assets in bulk', err);
        alert('Failed to import assets. Please verify the template formats and try again.');
      }
    });
  }

  protected downloadBulkUploadTemplate() {
    if (!isPlatformBrowser(this.platformId)) return;

    const headers = [
      'Asset ID',
      'Asset Name',
      'Category',
      'RFID Tag EPC',
      'GPS Device ID',
      'Site',
      'Zone',
      'Status',
      'Serial Number',
      'Custodian',
      'Description'
    ];

    const rows = [
      [
        'AST-TRC-005121',
        'Plastic Bin - Large C1',
        'Returnable Container',
        'E280689400107B2A00002A11',
        '-',
        'Pune DC',
        'Zone B',
        'Available',
        'PB-998231',
        'R. Kumar',
        'Standard industrial plastic crate'
      ],
      [
        'AST-FL-00987',
        'Toyota Forklift Model-X',
        'Vehicle',
        'E28011702000021A3F4B2C91',
        '16512010049',
        'Pune DC',
        'Yard A',
        'In Use',
        'TY-88746-FL',
        'A. Sharma',
        'Yard operations forklift'
      ],
      [
        'AST-LT-10292',
        'Dell Latitude 5420 Laptop',
        'IT Assets',
        'E28011702000021A3F4B2CA1',
        '-',
        'Mumbai Warehouse',
        'Office Area',
        'Available',
        'DL-5420-9982',
        'P. Patel',
        'Custodian office laptop'
      ],
      [
        'AST-PL-0082',
        'Standard Wooden Pallet P12',
        'Pallets',
        'E28011702000021A3F4B2C92',
        '-',
        'Chennai Plant',
        'Staging Zone',
        'Available',
        'PL-0082-WD',
        '-',
        'Standard EUR 1200x800mm wooden pallet'
      ],
      [
        'AST-GEN-55',
        'Cummins 250kVA Generator',
        'Power Equipment',
        'E28011702000021A3F4B2C93',
        '-',
        'Bengaluru Hub',
        'Power Room',
        'Under Maintenance',
        'CM-9982-GEN',
        'M. Gowda',
        'Back-up power diesel generator'
      ]
    ];

    const sheetData = [headers, ...rows];
    const ws = XLSX.utils.aoa_to_sheet(sheetData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Asset_Bulk_Template');

    // Auto-fit column widths
    const wscols = headers.map(() => ({ wch: 22 }));
    ws['!cols'] = wscols;

    XLSX.writeFile(wb, 'Asset_Bulk_Upload_Template.xlsx');
  }
  
  protected getCategoryCount(cat: string): number {
    return this.assets().filter(a => a.category === cat).length;
  }

  protected getCategoryInUseCount(cat: string): number {
    return this.assets().filter(a => a.category === cat && a.status === 'In Use').length;
  }

  protected getCategoryAvailableCount(cat: string): number {
    return this.assets().filter(a => a.category === cat && a.status === 'Available').length;
  }

  protected getCategoryUtilizationRate(cat: string): string {
    const total = this.getCategoryCount(cat);
    if (total === 0) return '0.0%';
    const inUse = this.getCategoryInUseCount(cat);
    return ((inUse / total) * 100).toFixed(1) + '%';
  }

  protected readonly assetGroupsList = computed(() => {
    const assets = this.assets();
    const groupsMap = new Map<string, any[]>();
    assets.forEach(a => {
      const gpName = a.group || 'Ungrouped';
      if (!groupsMap.has(gpName)) {
        groupsMap.set(gpName, []);
      }
      groupsMap.get(gpName)?.push(a);
    });

    // Build unique groups from customGroups + asset data
    const allGroupKeys = new Map<string, {name: string, category: string, custodian: string}>();

    // Add all custom groups first (these are always shown)
    this.customGroups().forEach(cg => {
      const key = cg.name + '|' + cg.categoryName;
      allGroupKeys.set(key, { name: cg.name, category: cg.categoryName, custodian: 'Supervisor' });
    });

    // Also add any groups found from existing asset data
    groupsMap.forEach((_, groupName) => {
      if (!Array.from(allGroupKeys.values()).some(g => g.name === groupName)) {
        allGroupKeys.set(groupName + '|', { name: groupName, category: '', custodian: 'Supervisor' });
      }
    });

    const list: any[] = [];
    allGroupKeys.forEach(g => {
      const items = groupsMap.get(g.name) || [];
      list.push({
        id: 'GRP-' + g.name.replace(/\s+/g, '-').toUpperCase(),
        name: g.name,
        category: g.category || 'Uncategorized',
        assetsCount: items.length,
        assetsLabel: items.length + (items.length === 1 ? ' Asset' : ' Assets'),
        custodian: g.custodian,
        alerts: '0 Alerts',
        status: 'Active'
      });
    });

    return list;
  });

  protected readonly groupSearchQuery = signal<string>('');

  protected readonly filteredAssetGroupsList = computed(() => {
    const q = this.groupSearchQuery().toLowerCase().trim();
    const list = this.assetGroupsList();
    if (!q) return list;
    return list.filter(g =>
      g.id.toLowerCase().includes(q) ||
      g.name.toLowerCase().includes(q) ||
      g.category.toLowerCase().includes(q) ||
      g.custodian.toLowerCase().includes(q)
    );
  });

  protected readonly availableGroupsForSelectedCategory = computed(() => {
    const catId = this.formCategory();
    const matchedCat = this.apiCategories().find(c => c.id && catId && c.id.toLowerCase() === catId.toLowerCase());
    const catName = matchedCat ? matchedCat.name : '';

    // Only show custom groups that belong to this category
    // Plus groups already used by existing assets in this category
    const customForCat = this.customGroups().filter(g => g.categoryName === catName);

    const usedGroups = this.assets()
      .filter(a => a.category === catName && a.group && a.group !== '—' && a.group !== 'Ungrouped')
      .map(a => ({ name: a.group!, categoryName: catName }));

    const merged = [...customForCat];
    usedGroups.forEach(ug => {
      if (!merged.some(g => g.name === ug.name)) {
        merged.push(ug);
      }
    });

    return merged;
  });

  // Notifications
  protected readonly notifications = signal<any[]>([]);

  // Site Data store
  private readonly siteData: Record<string, SiteStats> = {
    'Pune DC': {
      totalAssets: 0, activeAssets: 0, activePct: '0%',
      assetsInUse: 0, inUsePct: '0%', checkedOut: 0,
      underMaintenance: 0, maintenancePct: '0%', lowBatteryGps: 0,
      rfidReadsToday: 0, gpsPingsToday: 0, exceptionAlerts: 0, complianceTasks: 0,
      utilizationSpark: [0, 0, 0, 0, 0, 0, 0],
      accuracySpark: [0, 0, 0, 0, 0, 0, 0],
      savingsSpark: [0, 0, 0, 0, 0, 0, 0],
      turnaroundSpark: [0, 0, 0, 0, 0, 0, 0],
      utilizationOverTime: [0, 0, 0, 0, 0, 0, 0],
      statusCategory: [0, 0, 0, 0, 0],
      movementInbound: [0, 0, 0, 0, 0, 0],
      movementOutbound: [0, 0, 0, 0, 0, 0],
      movementUtilization: [0, 0, 0, 0, 0, 0],
      topCategories: [0, 0, 0, 0, 0, 0]
    },
    'Mumbai Warehouse': {
      totalAssets: 0, activeAssets: 0, activePct: '0%',
      assetsInUse: 0, inUsePct: '0%', checkedOut: 0,
      underMaintenance: 0, maintenancePct: '0%', lowBatteryGps: 0,
      rfidReadsToday: 0, gpsPingsToday: 0, exceptionAlerts: 0, complianceTasks: 0,
      utilizationSpark: [0, 0, 0, 0, 0, 0, 0],
      accuracySpark: [0, 0, 0, 0, 0, 0, 0],
      savingsSpark: [0, 0, 0, 0, 0, 0, 0],
      turnaroundSpark: [0, 0, 0, 0, 0, 0, 0],
      utilizationOverTime: [0, 0, 0, 0, 0, 0, 0],
      statusCategory: [0, 0, 0, 0, 0],
      movementInbound: [0, 0, 0, 0, 0, 0],
      movementOutbound: [0, 0, 0, 0, 0, 0],
      movementUtilization: [0, 0, 0, 0, 0, 0],
      topCategories: [0, 0, 0, 0, 0, 0]
    },
    'Chennai Plant': {
      totalAssets: 0, activeAssets: 0, activePct: '0%',
      assetsInUse: 0, inUsePct: '0%', checkedOut: 0,
      underMaintenance: 0, maintenancePct: '0%', lowBatteryGps: 0,
      rfidReadsToday: 0, gpsPingsToday: 0, exceptionAlerts: 0, complianceTasks: 0,
      utilizationSpark: [0, 0, 0, 0, 0, 0, 0],
      accuracySpark: [0, 0, 0, 0, 0, 0, 0],
      savingsSpark: [0, 0, 0, 0, 0, 0, 0],
      turnaroundSpark: [0, 0, 0, 0, 0, 0, 0],
      utilizationOverTime: [0, 0, 0, 0, 0, 0, 0],
      statusCategory: [0, 0, 0, 0, 0],
      movementInbound: [0, 0, 0, 0, 0, 0],
      movementOutbound: [0, 0, 0, 0, 0, 0],
      movementUtilization: [0, 0, 0, 0, 0, 0],
      topCategories: [0, 0, 0, 0, 0, 0]
    },
    'Bengaluru Hub': {
      totalAssets: 0, activeAssets: 0, activePct: '0%',
      assetsInUse: 0, inUsePct: '0%', checkedOut: 0,
      underMaintenance: 0, maintenancePct: '0%', lowBatteryGps: 0,
      rfidReadsToday: 0, gpsPingsToday: 0, exceptionAlerts: 0, complianceTasks: 0,
      utilizationSpark: [0, 0, 0, 0, 0, 0, 0],
      accuracySpark: [0, 0, 0, 0, 0, 0, 0],
      savingsSpark: [0, 0, 0, 0, 0, 0, 0],
      turnaroundSpark: [0, 0, 0, 0, 0, 0, 0],
      utilizationOverTime: [0, 0, 0, 0, 0, 0, 0],
      statusCategory: [0, 0, 0, 0, 0],
      movementInbound: [0, 0, 0, 0, 0, 0],
      movementOutbound: [0, 0, 0, 0, 0, 0],
      movementUtilization: [0, 0, 0, 0, 0, 0],
      topCategories: [0, 0, 0, 0, 0, 0]
    },
    'All Sites': {
      totalAssets: 0, activeAssets: 0, activePct: '0%',
      assetsInUse: 0, inUsePct: '0%', checkedOut: 0,
      underMaintenance: 0, maintenancePct: '0%', lowBatteryGps: 0,
      rfidReadsToday: 0, gpsPingsToday: 0, exceptionAlerts: 0, complianceTasks: 0,
      utilizationSpark: [0, 0, 0, 0, 0, 0, 0],
      accuracySpark: [0, 0, 0, 0, 0, 0, 0],
      savingsSpark: [0, 0, 0, 0, 0, 0, 0],
      turnaroundSpark: [0, 0, 0, 0, 0, 0, 0],
      utilizationOverTime: [0, 0, 0, 0, 0, 0, 0],
      statusCategory: [0, 0, 0, 0, 0],
      movementInbound: [0, 0, 0, 0, 0, 0],
      movementOutbound: [0, 0, 0, 0, 0, 0],
      movementUtilization: [0, 0, 0, 0, 0, 0],
      topCategories: [0, 0, 0, 0, 0, 0]
    }
  };

  protected readonly allEvents = signal<EventItem[]>([]);

  // UI state derived computed properties
  protected readonly currentStats = computed((): SiteStats => {
    const siteAssets = this.siteFilteredAssets();
    const totalS = siteAssets.length;
    const inUseS = siteAssets.filter(a => a.status === 'In Use' || a.status === 'Assigned').length;
    const availableS = siteAssets.filter(a => a.status === 'Available').length;
    const maintS = siteAssets.filter(a => a.status === 'Under Maintenance' || a.status === 'Maintenance').length;
    const checkedOutS = siteAssets.filter(a => a.status === 'Checked Out').length;
    const activeS = inUseS + availableS + maintS;
    const activePctS = totalS > 0 ? ((activeS / totalS) * 100).toFixed(1) + '%' : '0%';
    const inUsePctS = totalS > 0 ? ((inUseS / totalS) * 100).toFixed(1) + '%' : '0%';
    const maintPctS = totalS > 0 ? ((maintS / totalS) * 100).toFixed(1) + '%' : '0%';

    const computeStatusCategory = (assetList: Asset[]) => [
      assetList.filter(a => a.status === 'In Use' || a.status === 'Assigned').length,
      assetList.filter(a => a.status === 'Available').length,
      assetList.filter(a => a.status === 'Under Maintenance' || a.status === 'Maintenance').length,
      assetList.filter(a => a.status === 'Checked Out').length,
      assetList.filter(a => a.status === 'Retired' || a.status === 'Disposed').length
    ];

    const computeTopCategories = (assetList: Asset[]) => [
      assetList.filter(a => (a.category || '').toLowerCase().includes('container') || (a.category || '').toLowerCase().includes('returnable')).length,
      assetList.filter(a => (a.category || '').toLowerCase().includes('material') || (a.category || '').toLowerCase().includes('handling')).length,
      assetList.filter(a => (a.category || '').toLowerCase().includes('power') || (a.category || '').toLowerCase().includes('tool') || (a.category || '').toLowerCase().includes('equipment')).length,
      assetList.filter(a => (a.category || '').toLowerCase().includes('it') || (a.category || '').toLowerCase().includes('digital')).length,
      assetList.filter(a => (a.category || '').toLowerCase().includes('vehicle') || (a.category || '').toLowerCase().includes('truck')).length,
      assetList.filter(a => (a.category || '').toLowerCase().includes('consumable') || (a.category || '').toLowerCase().includes('raw') || (a.category || '').toLowerCase().includes('other') || (a.category || '').toLowerCase().includes('medical')).length
    ];

    const currentUtilPctS = totalS > 0 ? Math.round((inUseS / totalS) * 100) : 0;
    const siteName = this.selectedSite();
    const existing = this.siteData[siteName] || this.siteData['Pune DC'];

    return {
      ...existing,
      totalAssets: totalS,
      activeAssets: activeS,
      activePct: activePctS,
      assetsInUse: inUseS,
      inUsePct: inUsePctS,
      checkedOut: checkedOutS,
      underMaintenance: maintS,
      maintenancePct: maintPctS,
      statusCategory: computeStatusCategory(siteAssets),
      topCategories: computeTopCategories(siteAssets),
      utilizationOverTime: [
        Math.max(0, currentUtilPctS - 12),
        Math.max(0, currentUtilPctS - 8),
        Math.max(0, currentUtilPctS - 5),
        Math.max(0, currentUtilPctS - 3),
        Math.max(0, currentUtilPctS - 1),
        currentUtilPctS,
        currentUtilPctS
      ]
    };
  });

  // Refs for Chart elements
  @ViewChild('utilizationSparklineCanvas') utilizationSparklineCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('accuracySparklineCanvas') accuracySparklineCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('savingsSparklineCanvas') savingsSparklineCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('turnaroundSparklineCanvas') turnaroundSparklineCanvas!: ElementRef<HTMLCanvasElement>;
  
  @ViewChild('utilizationOverTimeCanvas') utilizationOverTimeCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('statusByCategoryCanvas') statusByCategoryCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('movementTrendsCanvas') movementTrendsCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('topCategoriesCanvas') topCategoriesCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('maintHealthTrendCanvas') maintHealthTrendCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('maintAlertDistributionCanvas') maintAlertDistributionCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('reportsInventoryAccuracyCanvas') reportsInventoryAccuracyCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('reportsAssetsByCategoryCanvas') reportsAssetsByCategoryCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('reportsZoneOccupancyCanvas') reportsZoneOccupancyCanvas!: ElementRef<HTMLCanvasElement>;

  // Chart instances for management (destruct/update)
  private charts: Record<string, Chart> = {};

  constructor() {
    // Restore state from localStorage if in browser
    if (isPlatformBrowser(this.platformId)) {
      this.isLoggedIn.set(true);
      localStorage.setItem('isLoggedIn', 'true');
      this.loadAllApiData();
      
      const savedNav = localStorage.getItem('activeNav');
      if (savedNav) {
        this.activeNav.set(savedNav);
        this.expandedItems.set({
          ...this.expandedItems(),
          [savedNav]: true
        });
      }
      
      const savedSubNav = localStorage.getItem('activeSubNav');
      if (savedSubNav) {
        this.activeSubNav.set(savedSubNav);
      }

      // Restore persisted custom groups
      const savedGroups = localStorage.getItem('customGroups');
      if (savedGroups) {
        try {
          this.customGroups.set(JSON.parse(savedGroups));
        } catch { /* ignore */ }
      }
    }

    this.fetchCategories();
    
    // Auto-select first allowed site if none is selected
    effect(() => {
      const sites = this.allowedUserSites();
      if (sites && sites.length > 0) {
        const current = this.selectedSite();
        if (!current || current === 'All Sites' || !sites.some((s: any) => s.name === current)) {
          this.selectedSite.set(sites[0].name);
          this.selectedSiteId.set(sites[0].id);
        }
      }
    });

    // Set default selected GPS asset
    if (this.gpsAssets().length > 0) {
      this.gpsSelectedAsset.set(this.gpsAssets()[0]);
    }

    // Sync with AuthService login state
    effect(() => {
      const loggedInInAuth = this.authService.isLoggedIn();
      if (!loggedInInAuth && this.isLoggedIn()) {
        this.isLoggedIn.set(false);
      }
    });

    // Periodic token expiration check
    if (isPlatformBrowser(this.platformId)) {
      setInterval(() => {
        if (this.authService.isLoggedIn()) {
          const token = this.authService.token();
          if (this.authService.isTokenExpired(token)) {
            this.authService.handleSessionExpired('Session Expired: Your token has expired. Please log in again.');
          }
        }
      }, 10000);
    }

    // Sync login and nav state to localStorage
    effect(() => {
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem('isLoggedIn', String(this.isLoggedIn()));
      }
    });

    effect(() => {
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem('activeNav', this.activeNav());
      }
    });

    effect(() => {
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem('activeSubNav', this.activeSubNav() || '');
      }
    });

    // React to selectedSite or activeOperation changes to update numbers and rebuild charts
    effect(() => {
      const site = this.selectedSite();
      const op = this.activeOperation();
      
      // Update charts on site or operation change (if already initialized in browser)
      if (isPlatformBrowser(this.platformId) && Object.keys(this.charts).length > 0) {
        this.isLoading.set(true);
        setTimeout(() => {
          this.destroyCharts();
          this.buildCharts();
          this.isLoading.set(false);
        }, 300);
      }
    });

    // React to GPS simulation settings changes
    effect(() => {
      const interval = this.gpsRefreshInterval();
      const autoRefresh = this.gpsAutoRefresh();
      const nav = this.activeNav(); 
      
      if (isPlatformBrowser(this.platformId)) {
        if (this.gpsTimerInterval) {
          clearInterval(this.gpsTimerInterval);
        }
        if (autoRefresh && nav === 'GPS Tracking') {
          this.startGpsAutoRefreshInterval();
        }
      }
    });
  }

  protected fetchCategories(callback?: () => void) {
    if (!this.isLoggedIn()) return;
    this.http.get<any[]>(`${environment.apiUrl}/categories?page=1&size=200`).subscribe({
      next: (data) => {
        if (Array.isArray(data)) {
          this.apiCategories.set(data);
        }
        if (callback) callback();
        else this.fetchAssets(); // always reload assets after categories update
      },
      error: (err) => console.error('Failed to fetch categories', err)
    });
  }

  protected fetchAssets() {
    if (!this.isLoggedIn()) return;
    this.http.get<any[]>(`${environment.apiUrl}/assets?page=1&size=1000`).subscribe({
      next: (data) => {
        const rfidPool = this.rfidTagsPool();
        const bcPool = this.barcodesPool();
        const gpsPool = this.gpsDevicesPool();

        const mapped = data.map(item => {
          const matchedCat = this.apiCategories().find(c => c.id && item.assetCategoryId && c.id.toLowerCase() === item.assetCategoryId.toLowerCase());
          const category = matchedCat ? matchedCat.name : (item.categoryName || 'Uncategorized');

          let status = 'Available';
          if (item.status === 'Assigned') status = 'In Use';
          else if (item.status === 'InTransit') status = 'Checked Out';
          else if (item.status === 'UnderMaintenance') status = 'Under Maintenance';
          else if (item.status === 'Available') status = 'Available';
          else if (item.status === 'Retired') status = 'Retired';

          // Resolve tags from linked pools
          const linkedRfid = rfidPool.find(t => {
            const tAssetId = (t.assetId || t.AssetId || '').toString().trim().toLowerCase();
            const itemId = (item.id || '').toString().trim().toLowerCase();
            const tEpc = (t.epcCode || t.EpcCode || '').toString().trim().toLowerCase();
            const itemNum = (item.assetNumber || '').toString().trim().toLowerCase();
            return (tAssetId && itemId && tAssetId === itemId) || (tEpc && itemNum && tEpc === itemNum);
          });
          const linkedBarcode = bcPool.find(b => {
            const bAssetId = (b.assetId || b.AssetId || '').toString().trim().toLowerCase();
            const itemId = (item.id || '').toString().trim().toLowerCase();
            return bAssetId && itemId && bAssetId === itemId;
          });
          const linkedGps = gpsPool.find(g => {
            const gAssetId = (g.assetId || g.AssetId || '').toString().trim().toLowerCase();
            const itemId = (item.id || '').toString().trim().toLowerCase();
            return gAssetId && itemId && gAssetId === itemId;
          });

          const resolvedRfidTag = linkedRfid
            ? (linkedRfid.epcCode || linkedRfid.EpcCode)
            : (item.rfidTag || item.epcCode || item.rfidTagEpc || '—');

          return {
            id: item.id,
            assetNumber: item.assetNumber || item.id,
            name: item.name,
            rfidTag: resolvedRfidTag,
            qrCode: linkedBarcode ? (linkedBarcode.barcodeValue || linkedBarcode.BarcodeValue) : (item.qrCode || '—'),
            gpsId: linkedGps ? (linkedGps.imei || linkedGps.Imei) : (item.gpsId || '—'),
            serialNumber: item.serialNumber || '—',
            category: category,
            group: item.group || '—',
            manufacturer: item.manufacturer || '—',
            model: item.model || '—',
            purchaseDate: item.purchaseDate ? new Date(item.purchaseDate).toLocaleDateString() : '—',
            warranty: item.warrantyExpiryDate ? new Date(item.warrantyExpiryDate).toLocaleDateString() : '—',
            status: status,
            currentLocation: (() => {
              const matchedLoc = this.apiLocations().find(l => l.id && item.locationId && l.id.toLowerCase() === item.locationId.toLowerCase());
              return matchedLoc ? matchedLoc.name : (item.currentLocation || 'Pune DC');
            })(),
            custodian: item.currentCustodian || 'Unassigned',
            currentCustodian: item.currentCustodian || 'Unassigned',
            ownerDepartment: item.ownerDepartment || '—',
            industry: item.industry || '—',
            businessUnit: item.businessUnit || '—',
            site: (() => {
              if (item.siteId) {
                const matchedSite = this.apiSites().find(s => s.id && s.id.toLowerCase() === item.siteId.toLowerCase());
                if (matchedSite) return matchedSite.name;
                
                // Fallback for hardcoded IDs
                return item.siteId === 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c91' ? 'Pune DC' :
                       item.siteId === 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c92' ? 'Mumbai Warehouse' :
                       item.siteId === 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c93' ? 'Chennai Plant' : 'Bengaluru Hub';
              }
              return '—';
            })(),
            zone: item.zoneId ? 'Zone A' : '—',
            assetType: item.assetType || 'Serialized',
            lastSeen: '—',
            nextMaintenance: '—',
            lastReader: '—',
            imei: linkedGps ? linkedGps.imei : '—',
            sim: '—',
            custodianEmail: item.custodianEmail || '—',
            warrantyProvider: item.warrantyProvider || '—',
            warrantyStart: item.purchaseDate ? new Date(item.purchaseDate).toLocaleDateString() : '—',
            warrantyEnd: item.warrantyExpiryDate ? new Date(item.warrantyExpiryDate).toLocaleDateString() : '—',
            warrantyStatus: item.warrantyExpiryDate && new Date(item.warrantyExpiryDate) > new Date() ? 'Active' as const : 'Expired' as const,
            vendorName: '—',
            vendorPhone: '—',
            vendorEmail: '—',
            image: item.image || item.Image || undefined,
            serviceHistory: []
          };
        });

        // ── Org-level isolation: Devam users only see assets from their sites ──
        const currentUser = this.authService.currentUser();
        const userEmail = (currentUser?.email || currentUser?.username || '').toLowerCase();
        let filteredMapped = mapped;
        if (userEmail.includes('devam')) {
          const allowedSiteIds = new Set(this.apiSites().map((s: any) => s.id?.toLowerCase()));
          filteredMapped = mapped.filter(a => {
            // If asset has no siteId it's unassigned, keep it only if there's no restriction
            if (!a.id) return false;
            // Try matching via the raw item's siteId stored in the mapped object
            const rawItem = data.find((d: any) => d.id === a.id);
            if (!rawItem) return false;
            const assetSiteId = (rawItem.siteId || '').toLowerCase();
            if (!assetSiteId) return false;
            return allowedSiteIds.has(assetSiteId);
          });
        }

        this.assets.set(filteredMapped);
        this.fetchScanEvents();
        this.fetchRealEvents();
        this.fetchInventoryScans();
        const allAssets = filteredMapped;

        const computeStatusCategory = (assetList: Asset[]) => [
          assetList.filter(a => a.status === 'In Use' || a.status === 'Assigned').length,
          assetList.filter(a => a.status === 'Available').length,
          assetList.filter(a => a.status === 'Under Maintenance' || a.status === 'Maintenance').length,
          assetList.filter(a => a.status === 'Checked Out').length,
          assetList.filter(a => a.status === 'Retired' || a.status === 'Disposed').length
        ];

        const computeTopCategories = (assetList: Asset[]) => [
          assetList.filter(a => (a.category || '').toLowerCase().includes('container') || (a.category || '').toLowerCase().includes('returnable')).length,
          assetList.filter(a => (a.category || '').toLowerCase().includes('material') || (a.category || '').toLowerCase().includes('handling')).length,
          assetList.filter(a => (a.category || '').toLowerCase().includes('power') || (a.category || '').toLowerCase().includes('tool') || (a.category || '').toLowerCase().includes('equipment')).length,
          assetList.filter(a => (a.category || '').toLowerCase().includes('it') || (a.category || '').toLowerCase().includes('digital')).length,
          assetList.filter(a => (a.category || '').toLowerCase().includes('vehicle') || (a.category || '').toLowerCase().includes('truck')).length,
          assetList.filter(a => (a.category || '').toLowerCase().includes('consumable') || (a.category || '').toLowerCase().includes('raw') || (a.category || '').toLowerCase().includes('other') || (a.category || '').toLowerCase().includes('medical')).length
        ];

        const totalAll = allAssets.length;
        const inUseAll = allAssets.filter(a => a.status === 'In Use' || a.status === 'Assigned').length;
        const availableAll = allAssets.filter(a => a.status === 'Available').length;
        const maintAll = allAssets.filter(a => a.status === 'Under Maintenance' || a.status === 'Maintenance').length;
        const checkedOutAll = allAssets.filter(a => a.status === 'Checked Out').length;
        const activeAll = inUseAll + availableAll + maintAll;
        const activePctAll = totalAll > 0 ? ((activeAll / totalAll) * 100).toFixed(1) + '%' : '0%';
        const inUsePctAll = totalAll > 0 ? ((inUseAll / totalAll) * 100).toFixed(1) + '%' : '0%';
        const maintPctAll = totalAll > 0 ? ((maintAll / totalAll) * 100).toFixed(1) + '%' : '0%';

        const currentUtilPctAll = totalAll > 0 ? Math.round((inUseAll / totalAll) * 100) : 0;
        const totalCheckoutsCount = this.checkoutRecords().length;
        const totalCheckinsCount = this.checkinRecords().length;

        this.siteData['All Sites'] = {
          ...this.siteData['All Sites'],
          totalAssets: totalAll,
          activeAssets: activeAll,
          activePct: activePctAll,
          assetsInUse: inUseAll,
          inUsePct: inUsePctAll,
          underMaintenance: maintAll,
          maintenancePct: maintPctAll,
          checkedOut: checkedOutAll,
          statusCategory: computeStatusCategory(allAssets),
          topCategories: computeTopCategories(allAssets),
          utilizationOverTime: [
            Math.max(0, currentUtilPctAll - 12),
            Math.max(0, currentUtilPctAll - 8),
            Math.max(0, currentUtilPctAll - 5),
            Math.max(0, currentUtilPctAll - 3),
            Math.max(0, currentUtilPctAll - 1),
            currentUtilPctAll,
            currentUtilPctAll
          ],
          movementInbound: [
            Math.max(1, totalCheckinsCount - 4),
            Math.max(1, totalCheckinsCount - 3),
            Math.max(1, totalCheckinsCount - 2),
            Math.max(1, totalCheckinsCount - 1),
            totalCheckinsCount,
            totalCheckinsCount
          ],
          movementOutbound: [
            Math.max(1, totalCheckoutsCount - 5),
            Math.max(1, totalCheckoutsCount - 4),
            Math.max(1, totalCheckoutsCount - 2),
            Math.max(1, totalCheckoutsCount - 1),
            totalCheckoutsCount,
            totalCheckoutsCount
          ],
          movementUtilization: [
            Math.max(0, currentUtilPctAll - 10),
            Math.max(0, currentUtilPctAll - 6),
            Math.max(0, currentUtilPctAll - 4),
            Math.max(0, currentUtilPctAll - 2),
            currentUtilPctAll,
            currentUtilPctAll
          ]
        };

        // Build per-site data for all known sites (including dynamic Devam sites)
        const staticSites = ['Pune DC', 'Mumbai Warehouse', 'Chennai Plant', 'Bengaluru Hub'];
        const dynamicSiteNames = this.apiSites().map((s: any) => s.name).filter((n: string) => !staticSites.includes(n));
        const sites = [...staticSites, ...dynamicSiteNames];
        sites.forEach(siteName => {
          const siteAssets = allAssets.filter(a => a.site === siteName);
          const totalS = siteAssets.length;
          const inUseS = siteAssets.filter(a => a.status === 'In Use' || a.status === 'Assigned').length;
          const availableS = siteAssets.filter(a => a.status === 'Available').length;
          const maintS = siteAssets.filter(a => a.status === 'Under Maintenance' || a.status === 'Maintenance').length;
          const checkedOutS = siteAssets.filter(a => a.status === 'Checked Out').length;
          const activeS = inUseS + availableS + maintS;
          const activePctS = totalS > 0 ? ((activeS / totalS) * 100).toFixed(1) + '%' : '0%';
          const inUsePctS = totalS > 0 ? ((inUseS / totalS) * 100).toFixed(1) + '%' : '0%';
          const maintPctS = totalS > 0 ? ((maintS / totalS) * 100).toFixed(1) + '%' : '0%';
          const currentUtilPctS = totalS > 0 ? Math.round((inUseS / totalS) * 100) : 0;
          const siteCheckouts = this.checkoutRecords().filter(r => r.site === siteName).length;
          const siteCheckins = this.checkinRecords().filter(r => r.site === siteName).length;

          this.siteData[siteName] = {
            ...this.siteData[siteName],
            totalAssets: totalS,
            activeAssets: activeS,
            activePct: activePctS,
            assetsInUse: inUseS,
            inUsePct: inUsePctS,
            underMaintenance: maintS,
            maintenancePct: maintPctS,
            checkedOut: checkedOutS,
            statusCategory: computeStatusCategory(siteAssets),
            topCategories: computeTopCategories(siteAssets),
            utilizationOverTime: [
              Math.max(0, currentUtilPctS - 12),
              Math.max(0, currentUtilPctS - 8),
              Math.max(0, currentUtilPctS - 5),
              Math.max(0, currentUtilPctS - 3),
              Math.max(0, currentUtilPctS - 1),
              currentUtilPctS,
              currentUtilPctS
            ],
            movementInbound: [
              Math.max(1, siteCheckins - 4),
              Math.max(1, siteCheckins - 3),
              Math.max(1, siteCheckins - 2),
              Math.max(1, siteCheckins - 1),
              siteCheckins,
              siteCheckins
            ],
            movementOutbound: [
              Math.max(1, siteCheckouts - 5),
              Math.max(1, siteCheckouts - 4),
              Math.max(1, siteCheckouts - 2),
              Math.max(1, siteCheckouts - 1),
              siteCheckouts,
              siteCheckouts
            ],
            movementUtilization: [
              Math.max(0, currentUtilPctS - 10),
              Math.max(0, currentUtilPctS - 6),
              Math.max(0, currentUtilPctS - 4),
              Math.max(0, currentUtilPctS - 2),
              currentUtilPctS,
              currentUtilPctS
            ]
          };
        });

        const selected = this.selectedSite();
        if (this.siteData[selected]) {
          if (isPlatformBrowser(this.platformId) && Object.keys(this.charts).length > 0) {
            this.buildCharts();
          }
        }

        this.resetAudit();
      },
      error: (err) => {
        console.error('Failed to fetch assets from backend', err);
      }
    });
  }

  protected fetchInventoryScans() {
    this.apiService.getInventoryScans().subscribe({
      next: (items: any[]) => {
        if (Array.isArray(items)) {
          this.inventoryItems.set(items);
        } else {
          this.inventoryItems.set([]);
        }
      },
      error: (err) => {
        console.error('Failed to fetch inventory scans:', err);
        this.inventoryItems.set([]);
      }
    });
  }

  protected openAddAssetModal() {
    this.modalMode.set('add');
    this.modalAssetId.set('');
    this.formAssetNumber.set('AST-' + Math.floor(100000 + Math.random() * 900000));
    this.formName.set('');
    const cats = this.apiCategories();
    if (cats.length > 0) {
      this.formCategory.set(cats[0].id);
    } else {
      this.formCategory.set('a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d');
    }
    this.formRfid.set('');
    this.formGps.set('');
    this.formStatus.set('Available');
    this.formSerialNumber.set('SN-' + Math.floor(10000000 + Math.random() * 90000000));
    this.formQrCode.set('');
    this.fetchTags();
    this.formGroup.set('');
    this.formManufacturer.set('');
    this.formModel.set('');
    this.formPurchaseDate.set(new Date().toISOString().substring(0, 10));
    this.formWarranty.set(new Date(Date.now() + 365*24*60*60*1000).toISOString().substring(0, 10));
    this.formWarrantyProvider.set('');
    this.formCustodian.set('');
    this.formCustodianEmail.set('');
    this.formDepartment.set('');
    this.formIndustry.set('');
    this.formBusinessUnit.set('');
    
    // Pre-populate with currently selected global site
    const currentSiteName = this.selectedSite();
    const currentSite = this.apiSites().find(s => s.name === currentSiteName);
    this.formSiteId.set(currentSite ? currentSite.id : '');

    this.formZoneId.set('');
    this.formWarehouseId.set('');
    this.formAssetType.set('Serialized');
    this.isModalOpen.set(true);
  }

  protected openEditAssetModal(asset: any) {
    this.modalMode.set('edit');
    this.modalAssetId.set(asset.id);
    this.formAssetNumber.set(asset.assetNumber || asset.id);
    this.formName.set(asset.name);
    
    const matchedCat = this.apiCategories().find(c => c.name === asset.category);
    const catGuid = matchedCat ? matchedCat.id : 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
    this.formCategory.set(catGuid);

    this.fetchTags();

    this.formRfid.set(asset.rfidTag === '—' ? '' : asset.rfidTag);
    this.formGps.set(asset.gpsId === '—' ? '' : asset.gpsId);

    let backStatus = 'Available';
    if (asset.status === 'In Use') backStatus = 'Assigned';
    else if (asset.status === 'Checked Out') backStatus = 'InTransit';
    else if (asset.status === 'Under Maintenance') backStatus = 'UnderMaintenance';
    this.formStatus.set(backStatus);

    this.formSerialNumber.set(asset.serialNumber || '');
    this.formQrCode.set(asset.qrCode === '—' ? '' : asset.qrCode);
    this.formGroup.set(asset.group || '');
    this.formManufacturer.set(asset.manufacturer || '');
    this.formModel.set(asset.model || '');
    this.formPurchaseDate.set(asset.purchaseDate ? asset.purchaseDate.substring(0, 10) : '');
    this.formWarranty.set(asset.warrantyEnd ? asset.warrantyEnd.substring(0, 10) : (asset.warranty ? asset.warranty.substring(0, 10) : ''));
    this.formWarrantyProvider.set(asset.warrantyProvider || '');
    this.formCustodian.set(asset.currentCustodian || '');
    this.formCustodianEmail.set(asset.custodianEmail || '');
    this.formDepartment.set(asset.ownerDepartment || '');
    this.formIndustry.set(asset.industry || '');
    this.formBusinessUnit.set(asset.businessUnit || '');
    this.formSiteId.set(asset.siteId || '');
    this.formZoneId.set(asset.zoneId || '');
    this.formWarehouseId.set(asset.warehouseId || '');
    this.formAssetType.set(asset.assetType || 'Serialized');

    this.isModalOpen.set(true);
  }

  protected saveAsset() {
    if (!this.formName() || !this.formAssetNumber()) {
      alert('Please fill out Name and Asset Number');
      return;
    }

    // Helper to validate a GUID string before sending
    const toGuid = (val: string) => {
      const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return val && guidRegex.test(val) ? val : null;
    };

    const payload = {
      assetNumber: this.formAssetNumber(),
      name: this.formName(),
      assetCategoryId: this.formCategory(),
      description: null,
      serialNumber: this.formSerialNumber() || null,
      status: this.formStatus() || 'Available',
      qrCode: this.formQrCode() || null,
      group: this.formGroup() || null,
      assetType: this.formAssetType() || 'Serialized',
      ownerDepartment: this.formDepartment() || null,
      industry: this.formIndustry() || null,
      businessUnit: this.formBusinessUnit() || null,
      currentCustodian: this.formCustodian() || null,
      custodianEmail: this.formCustodianEmail() || null,
      model: this.formModel() || null,
      warrantyProvider: this.formWarrantyProvider() || null,
      purchaseDate: this.formPurchaseDate() ? new Date(this.formPurchaseDate()).toISOString() : null,
      warrantyExpiryDate: this.formWarranty() ? new Date(this.formWarranty()).toISOString() : null,
      manufacturerId: null,
      siteId: toGuid(this.formSiteId()),
      zoneId: toGuid(this.formZoneId()),
      warehouseId: toGuid(this.formWarehouseId())
    };

    if (this.modalMode() === 'add') {
      this.http.post(`${environment.apiUrl}/assets`, payload).subscribe({
        next: (guid: any) => {
          const assetId = guid && guid.id ? guid.id : guid;
          if (assetId) {
            this.syncAssetTags(assetId);
          }
          this.isModalOpen.set(false);
          this.fetchAssets();
        },
        error: (err) => {
          console.error('Failed to create asset', err);
          alert('Failed to save asset. Check console for details.');
        }
      });
    } else {
      const editPayload = {
        id: this.modalAssetId(),
        ...payload
      };
      this.http.put(`${environment.apiUrl}/assets/${this.modalAssetId()}`, editPayload).subscribe({
        next: () => {
          this.syncAssetTags(this.modalAssetId());
          this.isModalOpen.set(false);
          this.fetchAssets();
        },
        error: (err) => {
          console.error('Failed to update asset', err);
          alert('Failed to update asset. Check console for details.');
        }
      });
    }
  }

  protected openBulkTagsModal() {
    this.formBulkTagsType.set('RFID');
    this.formBulkTagsText.set('');
    this.isBulkTagsModalOpen.set(true);
  }

  protected saveBulkTags() {
    if (!this.formBulkTagsText() || !this.formBulkTagsType()) {
      alert('Please fill out the tags list and select a Tag Type');
      return;
    }

    const lines = this.formBulkTagsText()
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);

    if (lines.length === 0) {
      alert('Please enter at least one tag code');
      return;
    }

    const type = this.formBulkTagsType();
    let url = `${environment.apiUrl}/rfidtags`;
    if (type === 'RFID') url = `${environment.apiUrl}/rfidtags`;
    else if (type === 'Barcode') url = `${environment.apiUrl}/barcodes`;
    else if (type === 'GPS') url = `${environment.apiUrl}/gpsdevices`;

    const requests = lines.map(code => {
      let body: any = {};
      if (type === 'RFID') {
        body = { epcCode: code, tidCode: null, assetId: null };
      } else if (type === 'Barcode') {
        body = { barcodeValue: code, format: 'Code128', assetId: null };
      } else if (type === 'GPS') {
        body = { imei: code, simNumber: null, assetId: null };
      }
      return this.http.post(url, body);
    });

    import('rxjs').then(({ forkJoin }) => {
      forkJoin(requests).subscribe({
        next: () => {
          alert(`Successfully registered ${lines.length} tags in bulk!`);
          this.isBulkTagsModalOpen.set(false);
          this.fetchTags();
        },
        error: (err) => {
          console.error('Bulk tag registration failed', err);
          alert('Bulk tag registration completed with some errors. Check console.');
          this.isBulkTagsModalOpen.set(false);
          this.fetchTags();
        }
      });
    });
  }

  protected syncAssetTags(assetId: string) {
    const rfidCode = this.formRfid();
    const barcodeVal = this.formQrCode();
    const gpsImei = this.formGps();

    // 1. Sync RFID Tag
    this.rfidTagsPool().forEach(tag => {
      const shouldBeLinked = tag.epcCode === rfidCode;
      const isCurrentlyLinked = tag.assetId === assetId;
      if (shouldBeLinked && !isCurrentlyLinked) {
        this.http.put(`${environment.apiUrl}/rfidtags/${tag.id}`, { ...tag, assetId }).subscribe();
      } else if (!shouldBeLinked && isCurrentlyLinked) {
        this.http.put(`${environment.apiUrl}/rfidtags/${tag.id}`, { ...tag, assetId: null }).subscribe();
      }
    });

    // 2. Sync Barcode
    this.barcodesPool().forEach(bc => {
      const shouldBeLinked = bc.barcodeValue === barcodeVal;
      const isCurrentlyLinked = bc.assetId === assetId;
      if (shouldBeLinked && !isCurrentlyLinked) {
        this.http.put(`${environment.apiUrl}/barcodes/${bc.id}`, { ...bc, assetId }).subscribe();
      } else if (!shouldBeLinked && isCurrentlyLinked) {
        this.http.put(`${environment.apiUrl}/barcodes/${bc.id}`, { ...bc, assetId: null }).subscribe();
      }
    });

    // 3. Sync GPS Device
    this.gpsDevicesPool().forEach(dev => {
      const shouldBeLinked = dev.imei === gpsImei;
      const isCurrentlyLinked = dev.assetId === assetId;
      if (shouldBeLinked && !isCurrentlyLinked) {
        this.http.put(`${environment.apiUrl}/gpsdevices/${dev.id}`, { ...dev, assetId }).subscribe();
      } else if (!shouldBeLinked && isCurrentlyLinked) {
        this.http.put(`${environment.apiUrl}/gpsdevices/${dev.id}`, { ...dev, assetId: null }).subscribe();
      }
    });
  }

  protected deleteAsset(id: string) {
    if (!confirm('Are you sure you want to delete this asset?')) {
      return;
    }
    this.http.delete(`${environment.apiUrl}/assets/${id}`).subscribe({
      next: () => {
        this.selectedAsset.set(null);
        this.fetchAssets();
      },
      error: (err) => {
        console.error('Failed to delete asset', err);
        alert('Failed to delete asset. Check console for details.');
      }
    });
  }

  protected changeAssetStatus(assetId: string, nextStatus: string) {
    const asset = this.assets().find(a => a.id === assetId);
    if (!asset) return;

    let backStatus = nextStatus;
    if (nextStatus === 'In Use') backStatus = 'Assigned';
    else if (nextStatus === 'Checked Out') backStatus = 'InTransit';
    else if (nextStatus === 'Under Maintenance') backStatus = 'UnderMaintenance';

    // Find category Guid from string category name
    let catGuid = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
    if (asset.category === 'Material Handling Equipment') catGuid = 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e';
    else if (asset.category === 'IT Assets') catGuid = 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f';
    else if (asset.category === 'Vehicle') catGuid = 'd4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a';
    else if (asset.category === 'Power Equipment') catGuid = 'e5f6a7b8-c9d0-1e2f-3a4b-5c6d7e8f9a0b';
    else if (asset.category === 'Material Handling') catGuid = 'f6a7b8c9-d0e1-2f3a-4b5c-6d7e8f9a0b1c';
    else if (asset.category === 'Consumables') catGuid = 'a7b8c9d0-e1f2-3a4b-5c6d-7e8f9a0b1c2d';

    const payload = {
      id: asset.id,
      assetNumber: asset.assetNumber,
      name: asset.name,
      assetCategoryId: catGuid,
      description: asset.rfidTag || 'Asset Details', // retain EPC
      serialNumber: asset.gpsId || '—', // retain GPS
      status: backStatus,
      qrCode: asset.qrCode,
      group: asset.group,
      assetType: asset.assetType,
      ownerDepartment: asset.ownerDepartment,
      industry: asset.industry,
      businessUnit: asset.businessUnit,
      currentCustodian: asset.currentCustodian,
      custodianEmail: asset.custodianEmail,
      model: asset.model,
      warrantyProvider: asset.warrantyProvider
    };

    this.http.put(`${environment.apiUrl}/assets/${asset.id}`, payload).subscribe({
      next: () => {
        alert(`Asset status changed to ${nextStatus} successfully in database!`);
        this.fetchAssets();
        setTimeout(() => {
          const updated = this.assets().find(a => a.id === assetId);
          if (updated) this.selectedAsset.set(updated);
        }, 400);
      },
      error: (err) => {
        console.error('Failed to change status', err);
        alert('Failed to change status');
      }
    });
  }

  protected openAddCategoryModal() {
    this.formCategoryName.set('');
    this.formCategoryDescription.set('');
    this.isCategoryModalOpen.set(true);
  }

  protected openAddGroupModal() {
    this.formGroupName.set('');
    const cats = this.apiCategories();
    if (cats.length > 0) {
      this.formGroupCategory.set(cats[0].id);
    } else {
      this.formGroupCategory.set('');
    }
    this.isGroupModalOpen.set(true);
  }

  protected saveCategory() {
    if (!this.formCategoryName()) {
      alert('Please enter Category Name');
      return;
    }
    const payload = {
      name: this.formCategoryName(),
      description: this.formCategoryDescription() || 'Custom Category'
    };
    this.http.post(`${environment.apiUrl}/categories`, payload).subscribe({
      next: () => {
        this.isCategoryModalOpen.set(false);
        alert('Category created successfully in PostgreSQL database!');
        this.fetchCategories();
      },
      error: (err) => {
        console.error('Failed to create category', err);
        alert('Failed to save category. Check console.');
      }
    });
  }

  protected saveGroup() {
    if (!this.formGroupName() || !this.formGroupCategory()) {
      alert('Please fill out Group Name and select a Category');
      return;
    }

    const catId = this.formGroupCategory();
    const matched = this.apiCategories().find(c => c.id && catId && c.id.toLowerCase() === catId.toLowerCase());
    const catName = matched ? matched.name : '';

    const newGroup = { name: this.formGroupName().trim(), categoryName: catName };

    if (this.customGroups().some(g => g.name === newGroup.name && g.categoryName === newGroup.categoryName)) {
      alert('A group with this name already exists for this category.');
      return;
    }

    this.customGroups.update(list => {
      const updated = [...list, newGroup];
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem('customGroups', JSON.stringify(updated));
      }
      return updated;
    });
    this.formGroupName.set('');
    this.formGroupCategory.set('');
    this.isGroupModalOpen.set(false);
  }

  protected deleteGroup(groupName: string) {
    if (!confirm(`Are you sure you want to delete the group "${groupName}"?`)) return;
    this.customGroups.update(list => {
      const updated = list.filter(g => g.name !== groupName);
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem('customGroups', JSON.stringify(updated));
      }
      return updated;
    });
  }

  protected deleteCategory(id: string) {
    if (!confirm('Are you sure you want to delete this Category? All assets inside it will remain but their category reference may be unassigned.')) {
      return;
    }
    this.http.delete(`${environment.apiUrl}/categories/${id}`).subscribe({
      next: () => {
        alert('Category deleted successfully from PostgreSQL!');
        this.fetchCategories();
      },
      error: (err) => {
        console.error('Failed to delete category', err);
        alert('Failed to delete category. It might be in use.');
      }
    });
  }

  private sessionTimerSeconds = 0;

  protected startScanSession() {
    this.isScanSessionRunning.set(true);
    this.startScanPolling();
    if (!this.scanTimerInterval) {
      this.scanTimerInterval = setInterval(() => {
        if (this.isScanSessionRunning()) {
          this.sessionTimerSeconds++;
          const hrs = String(Math.floor(this.sessionTimerSeconds / 3600)).padStart(2, '0');
          const mins = String(Math.floor((this.sessionTimerSeconds % 3600) / 60)).padStart(2, '0');
          const secs = String(this.sessionTimerSeconds % 60).padStart(2, '0');
          this.scanSessionTime.set(`${hrs}:${mins}:${secs}`);
        }
      }, 1000);
    }
  }

  protected pauseScanSession() {
    this.isScanSessionRunning.set(false);
    this.stopScanPolling();
  }

  protected stopScanSession() {
    this.isScanSessionRunning.set(false);
    this.sessionTimerSeconds = 0;
    this.scanSessionTime.set('00:00:00');
    if (this.scanTimerInterval) {
      clearInterval(this.scanTimerInterval);
      this.scanTimerInterval = null;
    }
    this.stopScanPolling();
  }

  protected downloadScanEventsCSV() {
    const events = this.scanEventsList();
    if (!events || events.length === 0) {
      alert('No scan events available to export.');
      return;
    }

    const headers = ['Index', 'EPC Code', 'Asset ID', 'Asset Name', 'Read Time (IST)', 'Location', 'Antenna', 'RSSI', 'Direction', 'Status', 'Source'];
    const rows = events.map((e: any) => [
      e.index || '',
      `"${e.epc || ''}"`,
      `"${e.assetId || ''}"`,
      `"${e.assetName || ''}"`,
      `"${e.time || ''}"`,
      `"${e.location || ''}"`,
      `"${e.antenna || ''}"`,
      `"${e.rssi || ''}"`,
      `"${e.direction || ''}"`,
      `"${e.status || ''}"`,
      `"${e.source || ''}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `rfid_scan_events_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  protected toggleAssignDropdown(event?: Event) {
    if (event) event.stopPropagation();
    this.isAssignDropdownOpen.set(!this.isAssignDropdownOpen());
  }

  protected openAssignTagModal(epc?: string) {
    this.isAssignDropdownOpen.set(false);
    if (epc) {
      this.selectedEpcForAssignment.set(epc);
    } else {
      const unknownEvent = this.scanEventsList().find(e => e.assetId === 'UNKNOWN TAG');
      if (unknownEvent) {
        this.selectedEpcForAssignment.set(unknownEvent.epc);
      } else if (this.scanEventsList().length > 0) {
        this.selectedEpcForAssignment.set(this.scanEventsList()[0].epc);
      } else {
        this.selectedEpcForAssignment.set('');
      }
    }
    this.isAssignTagModalOpen.set(true);
  }

  protected closeAssignTagModal() {
    this.isAssignTagModalOpen.set(false);
  }

  protected submitAssignTagToAsset() {
    const epc = this.selectedEpcForAssignment().trim();
    const assetId = this.formAssignAssetId().trim();

    if (!epc) {
      alert('Please specify an EPC Code.');
      return;
    }
    if (!assetId) {
      alert('Please select an Asset to assign to this RFID Tag.');
      return;
    }

    const tagDto = {
      epcCode: epc,
      assetId: assetId
    };

    this.apiService.createRFIDTag(tagDto).subscribe({
      next: () => {
        alert(`RFID Tag ${epc} successfully assigned to Asset!`);
        this.isAssignTagModalOpen.set(false);
        this.fetchScanEvents();
        this.fetchAssets();
      },
      error: (err: any) => {
        console.error('Failed to assign tag:', err);
        this.apiService.getAssets().subscribe({
          next: (assets: any[]) => {
            const targetAsset = assets.find(a => a.id === assetId);
            if (targetAsset) {
              targetAsset.rfidTag = epc;
              this.apiService.updateAsset(assetId, targetAsset).subscribe({
                next: () => {
                  alert(`RFID Tag ${epc} assigned to Asset ${targetAsset.name} (${targetAsset.assetNumber})!`);
                  this.isAssignTagModalOpen.set(false);
                  this.fetchScanEvents();
                  this.fetchAssets();
                },
                error: (e2) => alert('Failed to update asset tag assignment: ' + (e2.message || 'Error'))
              });
            }
          }
        });
      }
    });
  }

  protected quickAssignLocation() {
    this.isAssignDropdownOpen.set(false);
    const locName = prompt('Enter Location Name to assign to current scan session:', 'Aisle-777');
    if (locName) {
      alert(`Location set to "${locName}" for active scan session.`);
    }
  }

  protected quickAssignCustodian() {
    this.isAssignDropdownOpen.set(false);
    const operator = prompt('Enter Operator / Custodian Name:', 'John Doe (C72 Operator)');
    if (operator) {
      alert(`Custodian set to "${operator}" for active scan session.`);
    }
  }

  protected clearLiveScanStream() {
    this.isAssignDropdownOpen.set(false);
    if (confirm('Are you sure you want to clear the live event stream table?')) {
      this.scanEventsList.set([]);
    }
  }

  private startScanPolling() {
    this.stopScanPolling();
    this.fetchScanEvents();
    this.scanPollingInterval = setInterval(() => {
      if (this.isScanSessionRunning()) {
        this.fetchScanEvents();
      }
    }, 2000);
  }

  private stopScanPolling() {
    if (this.scanPollingInterval) {
      clearInterval(this.scanPollingInterval);
      this.scanPollingInterval = null;
    }
  }

  private assignmentPollingInterval: any = null;

  private startAssignmentPolling() {
    this.stopAssignmentPolling();
    this.assignmentPollingInterval = setInterval(() => {
      if (this.activeNav() === 'Check in/Check out' && this.isLoggedIn()) {
        this.fetchAssignments();
      }
    }, 2000);
  }

  private stopAssignmentPolling() {
    if (this.assignmentPollingInterval) {
      clearInterval(this.assignmentPollingInterval);
      this.assignmentPollingInterval = null;
    }
  }

  protected fetchScanEvents() {
    this.apiService.getScanEvents().subscribe({
      next: (res) => {
        const list = res || [];
        if (Array.isArray(list)) {
          // Deduplicate scans by EPC
          const uniqueMap = new Map<string, any>();
          list.forEach((e: any) => {
            const key = (e.epcCode || '').trim().toUpperCase();
            if (!key || !uniqueMap.has(key)) {
              uniqueMap.set(key, e);
            }
          });
          const deduplicatedList = Array.from(uniqueMap.values());

          this.scanEventsList.set(deduplicatedList.map((e: any, index: number) => {
            const epcClean = (e.epcCode || e.epc || '').trim().toLowerCase();
            const asset = this.assets().find(a => 
              (a.rfidTag || '').trim().toLowerCase() === epcClean || 
              (a.assetNumber || '').trim().toLowerCase() === epcClean
            );

            const rawAnt = e.antennaIndex || e.antennaPort || e.antennaId || e.antenna || e.antennaNo || 1;
            let antNum = 1;
            if (rawAnt) {
              const parsed = parseInt(String(rawAnt).replace(/[^0-9]/g, ''), 10);
              if (!isNaN(parsed) && parsed > 0) antNum = parsed;
            }
            const antennaStr = 'A' + antNum;
            const directionStr = (antNum === 1 || antNum === 2 || e.direction === 'OUT' || e.direction === 'EXIT') ? 'OUT' : 'IN';

            return {
              index: index + 1,
              epc: e.epcCode || e.epc,
              assetId: asset ? asset.assetNumber : 'UNKNOWN TAG',
              assetName: asset ? asset.name : 'Unknown Asset',
              time: e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : 'Just now',
              antenna: antennaStr,
              rssi: (e.rssi !== undefined ? e.rssi : -50) + ' dBm',
              direction: directionStr,
              status: e.status === 'Processed' ? 'Matched' : (e.status || 'Matched'),
              source: e.handheldDeviceName ? 'Scan from Handheld' : 'Scanned through Fixed Reader',
              location: asset && asset.currentLocation ? `${asset.currentLocation} (${asset.site || '—'})` : '—'
            };
          }));

          this.scanTotalReadCount.set(list.length);
          this.scanDuplicateCount.set(list.length - deduplicatedList.length);
          this.scanExceptionDuplicate.set(list.filter((e: any) => e.status === 'Duplicate').length);
          this.scanExceptionUnknown.set(list.filter((e: any) => e.status === 'Unmatched' || e.status === 'Unknown').length);

          const gateCount = list.filter((e: any) => e.readerName && e.readerName.includes('Gate')).length;
          const handheldCount = list.filter((e: any) => e.handheldDeviceName).length;
          this.activeGateReaderReads.set(gateCount);
          this.activeHandheldReaderReads.set(handheldCount);

          // Update each asset's lastReader and lastSeen details based on scan events
          const updatedAssets = this.assets().map(a => {
            const epcClean = (a.rfidTag || '').trim().toLowerCase();
            const matchingScans = list.filter((e: any) => (e.epcCode || '').trim().toLowerCase() === epcClean);
            
            let lastReader = '—';
            let lastSeen = a.lastSeen || '—';
            
            if (matchingScans.length > 0) {
              const latestScan = matchingScans.sort((x: any, y: any) => new Date(y.timestamp).getTime() - new Date(x.timestamp).getTime())[0];
              if (latestScan) {
                if (latestScan.handheldDeviceName) {
                  lastReader = `${latestScan.handheldDeviceName} (Handheld)`;
                } else if (latestScan.readerName) {
                  lastReader = `${latestScan.readerName} (Fixed)`;
                } else {
                  lastReader = 'Fixed Reader';
                }
                lastSeen = new Date(latestScan.timestamp).toLocaleString();
              }
            }
            return {
              ...a,
              lastReader: lastReader,
              lastSeen: lastSeen
            };
          });
          this.assets.set(updatedAssets);
        }
      },
      error: (err) => console.error('Failed to load scan events from PostgreSQL', err)
    });
  }

  protected async fetchRealEvents() {
    try {
      const scansRes = await firstValueFrom(this.apiService.getScanEvents()).catch(() => null);
      const readersRes = await firstValueFrom(this.apiService.getReaders()).catch(() => null);

      const scans = scansRes?.body || scansRes || [];
      const readers = readersRes?.body || readersRes || [];

      const rawEvents: { timestamp: Date, item: EventItem }[] = [];

      const readerSiteMap = new Map<string, string>();
      if (Array.isArray(readers)) {
        readers.forEach((r: any) => {
          if (r.id) {
            readerSiteMap.set(r.id.toLowerCase(), r.siteName || 'Pune DC');
          }
        });
      }

      const scannedAssetIds = new Set<string>();

      if (Array.isArray(scans) && scans.length > 0) {
        scans.forEach((e: any) => {
          const asset = this.assets().find(a => a.rfidTag === e.epcCode || a.assetNumber === e.epcCode || a.id === e.assetId);
          const dt = new Date(e.timestamp || Date.now());
          const timeStr = dt.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + dt.toLocaleTimeString('en-US', { hour12: true });
          
          let siteName = 'Pune DC';
          if (e.readerId && readerSiteMap.has(e.readerId.toLowerCase())) {
            siteName = readerSiteMap.get(e.readerId.toLowerCase())!;
          }

          if (e.epcCode) scannedAssetIds.add(e.epcCode.toLowerCase());
          if (e.assetId) scannedAssetIds.add(e.assetId.toLowerCase());
          if (asset?.assetNumber) scannedAssetIds.add(asset.assetNumber.toLowerCase());
          if (asset?.id) scannedAssetIds.add(asset.id.toLowerCase());
          if (asset?.rfidTag) scannedAssetIds.add(asset.rfidTag.toLowerCase());
          if (asset?.name) scannedAssetIds.add(asset.name.toLowerCase());

          rawEvents.push({
            timestamp: dt,
            item: {
              id: e.id || e.epcCode,
              time: timeStr,
              type: 'RFID Read',
              assetId: asset ? (asset.assetNumber || asset.id) : (e.epcCode || 'TAG-RFID-99'),
              assetName: asset ? asset.name : 'Scanned RFID Tag',
              category: asset ? asset.category : 'Returnable Container',
              location: siteName + ' - ' + (e.readerName || e.handheldDeviceName || 'Gate Reader'),
              details: `Antenna: A${e.antennaIndex || e.antennaPort || e.antennaId || 1}, RSSI: ${e.rssi || -55} dBm, Status: ${e.status || 'Active'}`,
              source: e.handheldDeviceName ? 'Scan from Handheld' : 'Scanned through Fixed Reader',
              operator: e.handheldDeviceName || 'System'
            }
          });
        });
      }

      // Also map Check-In / Check-Out records into rawEvents, skipping assets that already have a live RFID scan event
      const allCheckRecords = [...this.checkoutRecords(), ...this.checkinRecords()];
      allCheckRecords.forEach((c: any) => {
        const raw = c.raw || {};
        const idsToCheck = [
          c.epc,
          c.equipment,
          c.assetNumber,
          c.assetId,
          c.tagEpc,
          c.id,
          raw.assetId,
          raw.assetNumber,
          raw.asset?.assetNumber,
          raw.asset?.rfidTag,
          raw.asset?.id,
          raw.asset?.name
        ].filter(Boolean).map((x: string) => x.toString().toLowerCase());

        if (idsToCheck.some(id => scannedAssetIds.has(id))) {
          return; // Skip duplicate record for the same asset!
        }
        const dt = new Date(c.time || Date.now());
        const isHandheld = c.type === 'Handheld Reader' || (c.entity && c.entity.toLowerCase().includes('handheld'));
        const displayAssetId = raw.assetNumber || raw.asset?.assetNumber || c.assetNumber || c.assetId || c.epc || c.id;
        const displayAssetName = c.equipment || raw.assetName || raw.asset?.name || 'Tracked Asset';
        rawEvents.push({
          timestamp: dt,
          item: {
            id: c.id || c.tagEpc,
            time: c.time || dt.toLocaleString(),
            type: c.scanType || 'RFID Read',
            assetId: displayAssetId,
            assetName: displayAssetName,
            category: c.category || raw.asset?.category || 'Asset Movement',
            location: (c.site || 'Pune DC') + ' - ' + (isHandheld ? 'C72 Handheld Reader' : (c.gateName || 'Dispatch Gate')),
            details: `Purpose: ${c.purpose || 'CheckOut'}, Status: ${c.status || 'Active'}`,
            source: isHandheld ? 'Scan from Handheld' : (c.readerType || 'Fixed Reader Gate'),
            operator: isHandheld ? 'C72 Handheld Reader' : (c.driverName || c.custodian || 'Gate Operator')
          }
        });
      });

      // Sort by timestamp descending
      rawEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

      if (rawEvents.length > 0) {
        this.allEvents.set(rawEvents.map(x => x.item));
      }
    } catch (err) {
      console.error('Failed to load real events from database', err);
    }
  }

  private startScanSessionSimulation() {
    if (isPlatformBrowser(this.platformId)) {
      // 1. Session Timer Interval
      this.scanTimerInterval = setInterval(() => {
        if (!this.isScanSessionRunning()) return;
        const timeParts = this.scanSessionTime().split(':').map(Number);
        let hrs = timeParts[0];
        let mins = timeParts[1];
        let secs = timeParts[2] + 1;

        if (secs >= 60) {
          secs = 0;
          mins += 1;
        }
        if (mins >= 60) {
          mins = 0;
          hrs += 1;
        }

        const pad = (n: number) => n.toString().padStart(2, '0');
        this.scanSessionTime.set(`${pad(hrs)}:${pad(mins)}:${pad(secs)}`);
      }, 1000);

      // 2. Real Scan Events Fetching Interval — always refreshes (every 15s idle, 2s during active scan)
      this.scanSessionInterval = setInterval(() => {
        // Always refresh scan events and real events regardless of session state
        this.fetchScanEvents();
        this.fetchRealEvents();
      }, 15000); // refresh every 15 seconds always

      // 3. Fast refresh during active scan session
      setInterval(() => {
        if (!this.isScanSessionRunning()) return;
        this.fetchScanEvents();
        this.fetchRealEvents();
      }, 2000); // fast 2-second refresh when scan session is active
    }
  }

  protected loadAllApiData() {
    const currentUser = this.authService.currentUser();
    const userEmail = (currentUser?.email || currentUser?.username || '').toLowerCase();

    // Automatic Site Isolation: If user is devam@gmail.com (or newly provisioned user), isolate to clean new site
    if (userEmail.includes('devam')) {
      const devamSiteName = currentUser?.siteName && currentUser.siteName !== 'Global / All Sites' ? currentUser.siteName : 'Devam Site';
      if (!this.siteData[devamSiteName]) {
        this.siteData[devamSiteName] = {
          totalAssets: 0, activeAssets: 0, activePct: '0%',
          assetsInUse: 0, inUsePct: '0%', checkedOut: 0,
          underMaintenance: 0, maintenancePct: '0%', lowBatteryGps: 0,
          rfidReadsToday: 0, gpsPingsToday: 0, exceptionAlerts: 0, complianceTasks: 0,
          utilizationSpark: [0, 0, 0, 0, 0, 0, 0],
          accuracySpark: [0, 0, 0, 0, 0, 0, 0],
          savingsSpark: [0, 0, 0, 0, 0, 0, 0],
          turnaroundSpark: [0, 0, 0, 0, 0, 0, 0],
          utilizationOverTime: [0, 0, 0, 0, 0, 0, 0],
          statusCategory: [0, 0, 0, 0, 0],
          movementInbound: [0, 0, 0, 0, 0, 0],
          movementOutbound: [0, 0, 0, 0, 0, 0],
          movementUtilization: [0, 0, 0, 0, 0, 0],
          topCategories: [0, 0, 0, 0, 0, 0]
        };
      }
      this.selectedSite.set(devamSiteName);
    } else {
      // For master admin trackit@prosper.com, restore main site if needed
      if (this.selectedSite() === 'Devam Site') {
        this.selectedSite.set('Pune DC');
      }
    }

    this.apiService.getUsers().subscribe({
      next: (res) => {
        const list = res.body || res;
        if (Array.isArray(list)) {
          this.adminUsers.set(list.map(u => ({
            id: u.id,
            name: u.username,
            username: u.username,
            email: u.email,
            role: u.roles && u.roles.length ? u.roles.join(', ') : 'Viewer',
            roles: u.roles || [],
            siteId: u.siteId,
            siteName: u.siteName || 'Global / All Sites',
            status: u.isActive ? 'Active' : 'Inactive',
            lastLogin: 'Just now'
          })));
        }
      }
    });

    this.apiService.getReaders().subscribe({
      next: (res) => {
        const list = res.body || res;
        if (Array.isArray(list)) {
          this.adminReaders.set(list.map(r => ({
            id: r.id || r.name,
            model: r.model || 'Zebra FX9600',
            location: r.name,
            antennas: r.antennaCount !== undefined ? r.antennaCount : (r.antennas || 4),
            powerDbm: r.powerDbm || 30,
            ipAddress: r.ipAddress,
            status: r.status || 'Online',
            siteId: r.siteId,
            port: r.port
          })));

          this.fixedReadersList.set(list.map(r => {
            const antCount = r.antennaCount !== undefined ? r.antennaCount : (r.antennas || 4);
            return {
              id: r.id,
              name: r.name,
              model: r.model || 'Zebra FX9600',
              status: r.status || 'Online',
              ipAddress: r.ipAddress,
              macAddress: r.macAddress || '00:11:22:33:44:55',
              powerLevel: (r.powerDbm || 30) + ' dBm',
              lastActive: 'Just now',
              antennas: Array.from({ length: antCount }, (_, i) => `Antenna ${i + 1}: OK`)
            };
          }));
        }
      }
    });

    this.apiService.getAudits().subscribe({
      next: (res) => {
        const list = res.body || res;
        if (Array.isArray(list)) {
          this.complianceAudits.set(list.map(a => ({
            id: a.id,
            name: a.title,
            date: new Date(a.auditDate).toLocaleDateString(),
            status: a.status,
            score: 100,
            inspector: a.auditorName || 'System',
            checkedAssets: 0,
            failedAssets: 0
          })));
        }
      }
    });

    this.apiService.getDashboardData().subscribe({
      next: (res) => {
        if (res && res.siteStats && Array.isArray(res.siteStats)) {
          res.siteStats.forEach((s: any) => {
            const uiSiteName = s.siteName;
            if (this.siteData[uiSiteName]) {
              const active = s.inUse + s.available + s.maintenance;
              const activePct = s.total > 0 ? ((active / s.total) * 100).toFixed(1) + '%' : '0%';
              const inUsePct = s.total > 0 ? ((s.inUse / s.total) * 100).toFixed(1) + '%' : '0%';
              const maintPct = s.total > 0 ? ((s.maintenance / s.total) * 100).toFixed(1) + '%' : '0%';

              this.siteData[uiSiteName] = {
                ...this.siteData[uiSiteName],
                totalAssets: s.total,
                activeAssets: active,
                activePct: activePct,
                assetsInUse: s.inUse,
                inUsePct: inUsePct,
                underMaintenance: s.maintenance,
                maintenancePct: maintPct,
                rfidReadsToday: s.rfidReadsToday || 0,
                gpsPingsToday: s.gpsPingsToday || 0,
                exceptionAlerts: s.exceptionAlerts || 0,
                complianceTasks: s.complianceTasks || 0
              };
            }
          });

          // Aggregate All Sites stats dynamically
          let aggTotal = 0;
          let aggInUse = 0;
          let aggAvailable = 0;
          let aggMaintenance = 0;
          let aggRfidReads = 0;
          let aggGpsPings = 0;
          let aggExceptionAlerts = 0;
          let aggComplianceTasks = 0;
          res.siteStats.forEach((s: any) => {
            aggTotal += s.total;
            aggInUse += s.inUse;
            aggAvailable += s.available;
            aggMaintenance += s.maintenance;
            aggRfidReads += s.rfidReadsToday || 0;
            aggGpsPings += s.gpsPingsToday || 0;
            aggExceptionAlerts += s.exceptionAlerts || 0;
            aggComplianceTasks += s.complianceTasks || 0;
          });

          const aggActive = aggInUse + aggAvailable + aggMaintenance;
          const aggActivePct = aggTotal > 0 ? ((aggActive / aggTotal) * 100).toFixed(1) + '%' : '0%';
          const aggInUsePct = aggTotal > 0 ? ((aggInUse / aggTotal) * 100).toFixed(1) + '%' : '0%';
          const aggMaintPct = aggTotal > 0 ? ((aggMaintenance / aggTotal) * 100).toFixed(1) + '%' : '0%';

          this.siteData['All Sites'] = {
            ...this.siteData['All Sites'],
            totalAssets: aggTotal,
            activeAssets: aggActive,
            activePct: aggActivePct,
            assetsInUse: aggInUse,
            inUsePct: aggInUsePct,
            underMaintenance: aggMaintenance,
            maintenancePct: aggMaintPct,
            rfidReadsToday: aggRfidReads,
            gpsPingsToday: aggGpsPings,
            exceptionAlerts: aggExceptionAlerts,
            complianceTasks: aggComplianceTasks
          };

          const selected = this.selectedSite();
          if (this.siteData[selected]) {
            if (isPlatformBrowser(this.platformId) && Object.keys(this.charts).length > 0) {
              this.destroyCharts();
              this.buildCharts();
            }
          }
        }
      },
      error: (err) => {
        console.error('Failed to load dashboard statistics from backend', err);
      }
    });

    this.apiService.getHandhelds().subscribe({
      next: (res) => {
        const list = res.body || res;
        if (Array.isArray(list)) {
          this.adminHandhelds.set(list);
        }
      },
      error: (err) => console.error('Failed to load handheld devices from backend', err)
    });

    this.apiService.getHandheldSessions().subscribe({
      next: (res) => {
        const list = res.body || res;
        if (Array.isArray(list)) {
          this.handheldSessionsList.set(list);
        }
      },
      error: (err) => console.error('Failed to load handheld sessions from backend', err)
    });

    this.fetchAssignments();
    this.fetchAlerts();
    this.fetchSitesZonesWarehouses();
    this.fetchScanEvents();
    this.fetchRealEvents();
    // Categories must load first, which then triggers fetchAssets
    this.fetchCategories(() => {
      // After categories are loaded, load tags then assets (so tag pools are ready for asset mapping)
      this.fetchTagsThenAssets();
    });


  }

  protected fetchSitesZonesWarehouses() {
    if (!this.isLoggedIn()) return;

    const defaultSites = [
      { id: '1', name: 'Pune DC', location: 'Pune, Maharashtra' },
      { id: '2', name: 'Mumbai Warehouse', location: 'Mumbai, Maharashtra' },
      { id: '3', name: 'Chennai Plant', location: 'Chennai, Tamil Nadu' },
      { id: '4', name: 'Bengaluru Hub', location: 'Bengaluru, Karnataka' },
      { id: '5', name: 'Delhi NCR', location: 'Delhi NCR' },
      { id: '6', name: 'Hyderabad DC', location: 'Hyderabad, Telangana' }
    ];

    this.apiService.getSites(1, 200).subscribe({
      next: (res) => { 
        const data = res?.body || res;
        let sites = (Array.isArray(data) && data.length > 0) ? data : defaultSites;
        
        const currentUser = this.authService.currentUser();
        const userEmail = (currentUser?.email || currentUser?.username || '').toLowerCase();
        const userSiteId = currentUser?.siteId;
        const userSiteName = currentUser?.siteName;

        if (userEmail.includes('devam')) {
          const filtered = sites.filter((s: any) => {
            const name = (s.name || '').toLowerCase();
            const code = (s.code || '').toLowerCase();
            if (userSiteId && s.id === userSiteId) return true;
            if (userSiteName && userSiteName !== 'Global / All Sites' && name.includes(userSiteName.toLowerCase())) return true;
            if (name.includes('devam') || code.includes('devam') || name.includes('central store')) return true;
            return false;
          });

          sites = filtered.length > 0 ? filtered : [{
            id: userSiteId || 'devam-site-id',
            code: 'SITE-DEVAM-01',
            name: (userSiteName && userSiteName !== 'Global / All Sites') ? userSiteName : 'Devam Central Store Site Alpha',
            address: 'Devam Logistics Central Depot, Pune'
          }];

          // Keep selectedSite as 'All Sites' so the user sees their scoped data by default.
          // The allowedSiteNames computed ensures only Devam data is shown.
          this.selectedSite.set('All Sites');
        }

        this.apiSites.set(sites);
        const mapped = sites.map((s: any) => ({
          id: s.id,
          code: s.code || ('SITE-' + (s.id ? s.id.substring(0, 4).toUpperCase() : '001')),
          name: s.name,
          address: s.address || s.location || 'Construction Location'
        }));
        this.adminSites.set(mapped);

        this.fetchWarehousesFromApi();

        sites.forEach(s => {
          if (s && s.name && !this.siteData[s.name]) {
            this.siteData[s.name] = {
              totalAssets: 0, activeAssets: 0, activePct: '0%',
              assetsInUse: 0, inUsePct: '0%', checkedOut: 0,
              underMaintenance: 0, maintenancePct: '0%', lowBatteryGps: 0,
              rfidReadsToday: 0, gpsPingsToday: 0, exceptionAlerts: 0, complianceTasks: 0,
              utilizationSpark: [0, 0, 0, 0, 0, 0, 0],
              accuracySpark: [0, 0, 0, 0, 0, 0, 0],
              savingsSpark: [0, 0, 0, 0, 0, 0, 0],
              turnaroundSpark: [0, 0, 0, 0, 0, 0, 0],
              utilizationOverTime: [0, 0, 0, 0, 0, 0, 0],
              statusCategory: [0, 0, 0, 0, 0],
              movementInbound: [0, 0, 0, 0, 0, 0],
              movementOutbound: [0, 0, 0, 0, 0, 0],
              movementUtilization: [0, 0, 0, 0, 0, 0],
              topCategories: [0, 0, 0, 0, 0, 0]
            };
          }
        });
      },
      error: (err) => {
        console.error('Failed to load sites', err);
      }
    });

    this.apiService.getWarehouses(1, 200).subscribe({
      next: (res) => {
        const data = res?.body || res;
        if (Array.isArray(data)) {
          const currentUser = this.authService.currentUser();
          const userEmail = (currentUser?.email || currentUser?.username || '').toLowerCase();
          if (userEmail.includes('devam')) {
            const allowedSiteIds = new Set(this.apiSites().map((s: any) => s.id));
            const filteredWhs = data.filter((w: any) => 
              allowedSiteIds.has(w.siteId) || 
              (w.name && w.name.toLowerCase().includes('devam')) || 
              (w.code && w.code.toLowerCase().includes('devam')) ||
              (w.name && w.name.toLowerCase().includes('central store'))
            );
            this.apiWarehouses.set(filteredWhs);
          } else {
            this.apiWarehouses.set(data);
          }
        }
      },
      error: (err) => console.error('Failed to load warehouses', err)
    });

    this.apiService.getZones(1, 200).subscribe({
      next: (res) => {
        const data = res?.body || res;
        if (Array.isArray(data)) this.apiZones.set(data);
      },
      error: (err) => console.error('Failed to load zones', err)
    });

    this.apiService.getLocations(1, 200).subscribe({
      next: (res) => {
        const data = res?.body || res;
        if (Array.isArray(data)) this.apiLocations.set(data);
      },
      error: (err) => console.error('Failed to load locations', err)
    });
  }

  protected fetchTagsThenAssets() {
    import('rxjs').then(({ forkJoin }) => {
      forkJoin({
        rfid: this.http.get<any>(`${environment.apiUrl}/rfidtags?page=1&size=200`),
        barcode: this.http.get<any>(`${environment.apiUrl}/barcodes?page=1&size=200`),
        gps: this.http.get<any>(`${environment.apiUrl}/gpsdevices?page=1&size=200`)
      }).subscribe({
        next: (res) => {
          const rfidList: any[] = Array.isArray(res.rfid) ? res.rfid : (res.rfid?.body ?? []);
          const bcList: any[] = Array.isArray(res.barcode) ? res.barcode : (res.barcode?.body ?? []);
          const gpsList: any[] = Array.isArray(res.gps) ? res.gps : (res.gps?.body ?? []);

          this.rfidTagsPool.set(rfidList);
          this.barcodesPool.set(bcList);
          this.gpsDevicesPool.set(gpsList);

          // Now fetch assets — pools are ready for tag resolution
          this.fetchAssets();
          this.fetchLiveGpsLocations();
          this.fetchHandheldSessions();
          this.fetchRfidEvents();

          // Also populate tagsList for Tag Management view
          const list: any[] = [];
          rfidList.forEach(t => {
            list.push({ id: t.id, epc: t.epcCode, assetNumber: '-', assetName: 'Loading...', type: 'RFID Pass-Metal', RSSI: '-64 dBm', battery: '100%', lastSeen: 'Gate 2 Reader', time: 'Just now', status: t.status || 'Active', rawType: 'RFID' });
          });
          bcList.forEach(b => {
            list.push({ id: b.id, epc: b.barcodeValue, assetNumber: '-', assetName: 'Loading...', type: 'Barcode ' + b.format, RSSI: '-', battery: '-', lastSeen: 'Staging Scan', time: 'Just now', status: b.isActive ? 'Active' : 'Inactive', rawType: 'Barcode' });
          });
          gpsList.forEach(g => {
            list.push({ id: g.id, epc: g.imei, assetNumber: '-', assetName: 'Loading...', type: 'GPS Active Device', RSSI: '-72 dBm', battery: g.batteryLevel + '%', lastSeen: 'GPS Network', time: 'Just now', status: g.status === 'Online' ? 'Active' : 'Inactive', rawType: 'GPS' });
          });
          this.tagsList.set(list);
        },
        error: (err) => {
          console.error('Failed to load tags, fetching assets anyway', err);
          this.fetchAssets();
          this.fetchLiveGpsLocations();
        }
      });
    });
  }

  protected fetchAssignments() {
    import('rxjs').then(({ forkJoin }) => {
      forkJoin({
        assignments: this.apiService.getAssignments(),
        truckStatus: this.http.get<any>(`${environment.apiUrl}/Trucks/complete-status`)
      }).subscribe({
        next: (res) => {
          const list = res.assignments.body || res.assignments;
          const truckData = res.truckStatus;

          if (Array.isArray(list)) {
            this.issueWorkOrders.set(list.map((a: any) => {
              const isReturned = a.actualReturnDate != null || a.status === 'Returned';
              return {
                id: a.id,
                assetNumber: a.assetNumber || (a.asset ? a.asset.assetNumber : ''),
                assetName: a.assetName || (a.asset ? a.asset.name : ''),
                custodian: a.custodianName || a.assignedToUsername || 'System',
                project: a.purpose || 'General Use',
                issueDate: new Date(a.assignedDate).toLocaleDateString(),
                returnDate: a.expectedReturnDate ? new Date(a.expectedReturnDate).toLocaleDateString() : '—',
                status: isReturned ? 'Returned' : (a.expectedReturnDate && new Date(a.expectedReturnDate) < new Date() ? 'Overdue' : 'Active'),
                progress: isReturned ? 100 : 20,
                actualReturnDate: a.actualReturnDate ? new Date(a.actualReturnDate).toLocaleDateString() : undefined
              };
            }));
          }

          const checkouts: any[] = [];
          const checkins: any[] = [];
          const addedCheckoutIds = new Set<string>();
          const addedCheckinIds = new Set<string>();

          // Track which entities/custodians have performed check-in scans
          const entitiesWithCheckin = new Set<string>();

          if (truckData && Array.isArray(truckData.trucks)) {
            truckData.trucks.forEach((t: any) => {
              const driverName = t.truck?.driver || (t.truck?.truckNumber ? t.truck.truckNumber.replace('Individual-', '') : 'Driver / Custodian');
              if (t.checkIn && Array.isArray(t.checkIn.table) && t.checkIn.table.length > 0) {
                entitiesWithCheckin.add(driverName.toLowerCase());
              }
            });
          }

          if (Array.isArray(list)) {
            list.forEach((a: any) => {
              const isReturned = a.actualReturnDate != null || a.status === 'Returned';
              if (isReturned) {
                const entityName = a.custodianName || a.assignedToUsername || 'Individual Custodian';
                entitiesWithCheckin.add(entityName.toLowerCase());
              }
            });
          }

          // 1. Process complete-status response (from Exit & Entry reader scan events)
          if (truckData && Array.isArray(truckData.trucks)) {
            truckData.trucks.forEach((t: any) => {
              const driverName = t.truck?.driver || (t.truck?.truckNumber ? t.truck.truckNumber.replace('Individual-', '') : 'Driver / Custodian');

              // Build sets of equipment IDs that were checked IN or MISSING for this driver
              const checkinEquipmentIds = new Set<string>();
              const missingEquipmentIds = new Set<string>();
              if (t.checkIn && Array.isArray(t.checkIn.table)) {
                t.checkIn.table.forEach((ci: any) => {
                  if (ci.gateStatus === 'Missing' || ci.gateStatus === 'MISSING') {
                    if (ci.equipmentId) missingEquipmentIds.add(ci.equipmentId);
                    if (ci.tagName) missingEquipmentIds.add(ci.tagName);
                    if (ci.equipment) missingEquipmentIds.add(ci.equipment.toLowerCase());
                  } else {
                    if (ci.equipmentId) checkinEquipmentIds.add(ci.equipmentId);
                    if (ci.tagName) checkinEquipmentIds.add(ci.tagName);
                  }
                });
              }

              if (t.checkOut && Array.isArray(t.checkOut.table)) {
                t.checkOut.table.forEach((co: any) => {
                  const driverLower = (driverName || '').toLowerCase();
                  const eqTypeLower = (co.equipmentType || '').toLowerCase();
                  if (driverLower.includes('entry') || eqTypeLower.includes('checkin') || eqTypeLower.includes('entry')) return;

                  const dedupeKey = (co.equipmentId || co.tagName || co.equipment) + '_' + driverName;
                  if (addedCheckoutIds.has(co.equipmentId) || addedCheckoutIds.has(co.tagName) || addedCheckoutIds.has(dedupeKey)) return;
                  if (co.equipmentId) addedCheckoutIds.add(co.equipmentId);
                  if (co.tagName) addedCheckoutIds.add(co.tagName);
                  addedCheckoutIds.add(dedupeKey);

                  const dtStr = co.checkOutDate ? new Date(co.checkOutDate).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : 'Just now';

                  // Was this specific asset returned or missing?
                  const wasReturned = co.equipmentId
                    ? checkinEquipmentIds.has(co.equipmentId)
                    : (co.tagName ? checkinEquipmentIds.has(co.tagName) : false);

                  const isMissingInCheckin = (co.equipmentId && missingEquipmentIds.has(co.equipmentId)) ||
                                             (co.tagName && missingEquipmentIds.has(co.tagName)) ||
                                             (co.equipment && missingEquipmentIds.has(co.equipment.toLowerCase()));

                  let detectedStatus = co.detected || '-';
                  if (!co.detected || co.detected === '' || co.detected === 'Active' || co.detected === '-') {
                    detectedStatus = wasReturned ? 'RETURNED' : (isMissingInCheckin ? 'MISSING' : 'RETURNED');
                  }

                  let entityName = co.operatorName || driverName;
                  let checkoutType = 'Handheld Reader';
                  if (entityName === 'EXIT' || driverName === 'EXIT' || eqTypeLower.includes('fixed') || eqTypeLower.includes('portal') || (co.operatorName && co.operatorName.toLowerCase() === 'exit')) {
                    checkoutType = 'READER';
                  } else {
                    checkoutType = 'Handheld Reader';
                  }

                  if (!entityName || entityName === 'Handheld RFID Reader' || entityName === 'Handheld Operator' || entityName === 'Standalone Handheld Operator' || entityName === 'Warehouse Exit/Entry Door') {
                    entityName = (checkoutType === 'Handheld Reader') ? 'Handheld Reader' : 'EXIT';
                  }

                  checkouts.push({
                    id: co.equipmentId || co.tagName,
                    entity: entityName,
                    equipment: co.equipment,
                    type: checkoutType,
                    epc: co.tagName || (co.equipmentId ? 'E200' + co.equipmentId.substring(0, 8) : 'EPC-UNKNOWN'),
                    detected: detectedStatus,
                    time: dtStr,
                    gateStatus: wasReturned ? 'Passed' : 'Pending',
                    checkinTime: '-',
                    site: 'Pune DC',
                    raw: { id: co.equipmentId }
                  });
                });
              }

              if (t.checkIn && Array.isArray(t.checkIn.table)) {
                t.checkIn.table.forEach((ci: any) => {
                  const dedupeKey = (ci.equipmentId || ci.tagName || ci.equipment) + '_checkin_' + driverName;
                  if (addedCheckinIds.has(ci.equipmentId) || addedCheckinIds.has(ci.tagName) || addedCheckinIds.has(dedupeKey)) return;

                  // Only include in checkin panel if actually returned or missing case
                  const isRealReturn = true;

                  if (ci.equipmentId) addedCheckinIds.add(ci.equipmentId);
                  if (ci.tagName) addedCheckinIds.add(ci.tagName);
                  addedCheckinIds.add(dedupeKey);

                  const dtStr = ci.checkInDate ? new Date(ci.checkInDate).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }) : 'Just now';
                  let ciEntity = driverName;
                  if (!ciEntity || ciEntity === 'Warehouse Exit/Entry Door' || ciEntity === 'Handheld RFID Reader' || ciEntity === 'EXIT') {
                    ciEntity = 'ENTRY';
                  }

                  checkins.push({
                    id: ci.equipmentId || ci.tagName,
                    entity: ciEntity,
                    equipment: ci.equipment,
                    type: (ciEntity === 'ENTRY') ? 'READER' : 'Handheld Reader',
                    epc: ci.tagName || (ci.equipmentId ? 'E200' + ci.equipmentId.substring(0, 8) : 'EPC-UNKNOWN'),
                    gateStatus: (ciEntity === 'ENTRY') ? '-' : (ci.gateStatus === 'Matched' ? 'RETURNED' : (ci.gateStatus || '-')),
                    checkinTime: dtStr,
                    site: 'Pune DC',
                    raw: { id: ci.equipmentId }
                  });
                });
              }
            });
          }

          // 2. Process AssetAssignments records
          if (Array.isArray(list)) {
            const missingAssetKeys = new Set<string>();
            const returnedAssetKeys = new Set<string>();
            const custodiansWithCheckins = new Set<string>();

            // Calculate tag scan counts across list to distinguish 1st scan (-) vs 2nd+ scan (RETURNED)
            const tagScanCountMap = new Map<string, number>();
            list.forEach((a: any) => {
              const keysToCount = [
                a.assetId,
                a.id,
                a.assetNumber,
                a.assetName,
                a.asset?.name,
                a.asset?.rfidTag
              ].filter(Boolean).map((k: string) => k.toLowerCase().trim());

              const uniqueKeys = new Set<string>(keysToCount);
              uniqueKeys.forEach(epcKey => {
                tagScanCountMap.set(epcKey, (tagScanCountMap.get(epcKey) || 0) + 1);
              });
            });

            list.forEach((a: any) => {
              const isRet = a.actualReturnDate != null || a.status === 'Returned' || a.status === 'Completed';
              const isMiss = a.status === 'Missing' || (a.notes && a.notes.includes('Missing'));
              
              const rawCust = (a.custodianName || a.assignedToUsername || a.assignedToName || '').toLowerCase().trim();
              if (isRet && rawCust && rawCust !== 'warehouse exit/entry door' && rawCust !== 'exit' && rawCust !== 'handheld reader') {
                custodiansWithCheckins.add(rawCust);
              }

              const keys = [
                a.assetId,
                a.id,
                a.assetNumber,
                a.assetName,
                a.asset?.name,
                a.asset?.rfidTag
              ].filter(Boolean).map((k: string) => k.toLowerCase().trim());

              keys.forEach((k: string) => {
                if (isMiss) {
                  missingAssetKeys.add(k);
                } else if (isRet) {
                  returnedAssetKeys.add(k);
                }
              });
            });

            list.forEach((a: any) => {
              const isReturned = a.actualReturnDate != null || a.status === 'Returned' || a.status === 'Completed';
              const isMissing = a.status === 'Missing' || (a.notes && a.notes.includes('Missing'));
              const isCompleted = a.status === 'Completed' || (a.notes && (a.notes.includes('Completed') || a.notes.includes('Handheld Inventory')));

              const siteName = a.asset && a.asset.siteId ? (
                a.asset.siteId === 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c91' ? 'Pune DC' :
                a.asset.siteId === 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c92' ? 'Mumbai Warehouse' :
                a.asset.siteId === 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c93' ? 'Chennai Plant' : 'Bengaluru Hub'
              ) : 'Pune DC';

              const rawCust = (a.custodianName || a.assignedToUsername || a.assignedToName || '').trim();
              const rawCustLower = rawCust.toLowerCase();
              const purposeLower = (a.purpose || '').toLowerCase();
              const notesLower = (a.notes || '').toLowerCase();

              const isEntryScan = purposeLower.includes('entry') || rawCustLower === 'entry' || notesLower.includes('antenna 4') || notesLower.includes('antenna 3') || notesLower.includes('fixed entry') || notesLower.includes('checkin');
              const isExitScan = purposeLower.includes('exit') || rawCustLower === 'exit' || notesLower.includes('antenna 1') || notesLower.includes('antenna 2') || notesLower.includes('fixed exit') || notesLower.includes('checkout');
              const isHandheldScan = purposeLower.includes('handheld') || purposeLower.includes('individual') || notesLower.includes('handheld') || (!isEntryScan && !isExitScan && rawCustLower !== 'exit' && rawCustLower !== 'entry' && rawCustLower !== 'warehouse exit/entry door');

              // Prefer actual custodian / individual / driver name
              let rawEntity = rawCust;
              if (!rawEntity || rawCustLower === 'standalone handheld operator' || rawCustLower === 'handheld operator' || rawCustLower === 'handheld rfid reader' || rawCustLower === 'individual custodian') {
                if (isExitScan) {
                  rawEntity = 'EXIT';
                } else if (isEntryScan) {
                  rawEntity = 'ENTRY';
                } else {
                  rawEntity = 'Handheld Reader';
                }
              }

              let formattedType = 'Handheld Reader';
              if (isExitScan || isEntryScan || (rawCustLower === 'exit' || rawCustLower === 'entry') || (purposeLower === 'reader' && (rawCustLower === 'exit' || rawCustLower === 'entry'))) {
                formattedType = 'READER';
              } else {
                formattedType = 'Handheld Reader';
              }

              const epcVal = a.asset && a.asset.rfidTag ? a.asset.rfidTag : (a.assetNumber || 'AST-TRC-001245');

              const itemKeys = [
                a.assetId,
                a.id,
                a.assetNumber,
                a.assetName,
                a.asset?.name,
                a.asset?.rfidTag,
                epcVal
              ].filter(Boolean).map((k: string) => k.toLowerCase().trim());

              const isAssetMissing = itemKeys.some(k => missingAssetKeys.has(k));
              const isAssetReturned = itemKeys.some(k => returnedAssetKeys.has(k));
              const hasCustodianCheckedIn = custodiansWithCheckins.has(rawEntity.toLowerCase().trim());

              let scanCount = 1;
              for (const k of itemKeys) {
                if (tagScanCountMap.has(k)) {
                  scanCount = Math.max(scanCount, tagScanCountMap.get(k)!);
                }
              }

              let detectedVal = '-';
              let checkinGateStatus: string | null = null;

              if (formattedType === 'READER' || isExitScan || isEntryScan || rawEntity === 'EXIT' || rawEntity === 'ENTRY') {
                // A fixed reader tag is ONLY considered checked out if an explicit check-out record exists for its EPC
                const isTagCheckedOut = checkouts.some((c: any) => c.epc && epcVal && c.epc.toLowerCase() === epcVal.toLowerCase());
                const fixedStatus = isTagCheckedOut ? 'RETURNED' : '-';

                if (isEntryScan || rawEntity === 'ENTRY') {
                  checkinGateStatus = fixedStatus;
                  detectedVal = '-';
                } else if (isExitScan || rawEntity === 'EXIT') {
                  detectedVal = fixedStatus;
                  checkinGateStatus = isTagCheckedOut ? 'RETURNED' : null;
                } else {
                  checkinGateStatus = fixedStatus;
                  detectedVal = fixedStatus;
                }
              } else if (isReturned || isCompleted) {
                checkinGateStatus = isCompleted ? 'COMPLETED' : 'RETURNED';
                detectedVal = isCompleted ? 'COMPLETED' : 'RETURNED';
              } else if (isMissing || isAssetMissing || hasCustodianCheckedIn) {
                checkinGateStatus = 'MISSING';
                detectedVal = 'MISSING';
              } else {
                detectedVal = '-';
                checkinGateStatus = null;
              }

              const rawCheckinTimestamp = a.actualReturnDate || a.checkInDate || a.updatedOn || a.assignedDate || a.createdOn || a.timestamp;
              const formattedCheckinTime = rawCheckinTimestamp
                ? new Date(rawCheckinTimestamp).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
                : new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

              const item = {
                id: a.id,
                entity: rawEntity,
                equipment: a.assetName || (a.asset ? a.asset.name : 'Scanned Asset'),
                type: formattedType,
                epc: epcVal,
                detected: detectedVal,
                time: new Date(a.assignedDate).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false }),
                gateStatus: isReturned ? 'Passed' : 'Pending',
                checkinTime: formattedCheckinTime,
                site: siteName,
                raw: a
              };

              // ENTRY scans MUST NOT appear in Check-Out panel
              if (!isEntryScan && !rawCustLower.includes('entry') && rawEntity !== 'ENTRY') {
                const checkoutDedupeKey = (epcVal || a.assetId || a.id) + '_' + rawEntity;
                const existingCheckout = checkouts.find(c => 
                  (epcVal && c.epc && c.epc.toLowerCase() === epcVal.toLowerCase()) ||
                  (a.assetId && c.id === a.assetId) ||
                  (a.id && c.id === a.id)
                );

                if (existingCheckout) {
                  existingCheckout.type = (rawEntity === 'EXIT' || isExitScan) ? 'READER' : 'Handheld Reader';
                  if (rawEntity && rawEntity !== 'Warehouse Exit/Entry Door' && rawEntity !== 'Handheld Reader') {
                    existingCheckout.entity = rawEntity;
                  }
                  existingCheckout.detected = detectedVal;
                } else if (!addedCheckoutIds.has(a.assetId) && !addedCheckoutIds.has(a.id) && !addedCheckoutIds.has(checkoutDedupeKey)) {
                  addedCheckoutIds.add(a.assetId);
                  addedCheckoutIds.add(a.id);
                  if (checkoutDedupeKey) addedCheckoutIds.add(checkoutDedupeKey);
                  checkouts.push(item);
                }
              }

              // Check-In panel: ONLY include if Returned, Missing, Completed, or Entry scan
              if (checkinGateStatus) {
                const checkinDedupeKey = (epcVal || a.assetId || a.id) + '_checkin_' + rawEntity;
                
                // Match existing checkin record strictly by unique EPC or ID
                const existingCheckin = checkins.find(c => 
                  (epcVal && c.epc && c.epc.toLowerCase() === epcVal.toLowerCase()) ||
                  (a.assetId && c.id === a.assetId) ||
                  (a.id && c.id === a.id)
                );

                let checkinEntity = rawEntity;
                if (!checkinEntity || checkinEntity === 'Warehouse Exit/Entry Door' || checkinEntity === 'EXIT' || checkinEntity === 'Handheld RFID Reader') {
                  checkinEntity = (formattedType === 'Handheld Reader') ? 'Handheld Reader' : 'ENTRY';
                }
                const checkinType = (formattedType === 'Handheld Reader') ? 'Handheld Reader' : 'READER';

                if (existingCheckin) {
                  existingCheckin.entity = checkinEntity;
                  existingCheckin.type = checkinType;
                  existingCheckin.gateStatus = checkinGateStatus;
                  if (!existingCheckin.checkinTime || existingCheckin.checkinTime === '-') {
                    existingCheckin.checkinTime = formattedCheckinTime;
                  }
                } else if (!addedCheckinIds.has(a.assetId) && !addedCheckinIds.has(a.id) && !addedCheckinIds.has(checkinDedupeKey)) {
                  addedCheckinIds.add(a.assetId);
                  addedCheckinIds.add(a.id);
                  if (checkinDedupeKey) addedCheckinIds.add(checkinDedupeKey);
                  checkins.push({
                    ...item,
                    entity: checkinEntity,
                    type: checkinType,
                    gateStatus: checkinGateStatus,
                    checkinTime: formattedCheckinTime
                  });
                }
              }
            });
          }

          // Enforce READER type and RETURNED status for all EXIT entity Check-Out items
          checkouts.forEach((c: any) => {
            if (c.entity === 'EXIT' || (c.raw && c.raw.purpose && c.raw.purpose.toLowerCase().includes('fixed')) || (c.raw && c.raw.custodianName && c.raw.custodianName.toLowerCase() === 'exit')) {
              c.type = 'READER';
              if (!c.detected || c.detected === '-' || c.detected === 'Active') {
                c.detected = 'RETURNED';
              }
            } else {
              c.type = 'Handheld Reader';
            }

            // Cross-reference: If this specific tag (by non-empty EPC) has undergone a check-out, update its matching check-in gate status to RETURNED
            if (c.epc && c.epc !== 'EPC-UNKNOWN' && c.epc !== '—') {
              const matchIn = checkins.find((ci: any) => ci.epc && ci.epc.toLowerCase() === c.epc.toLowerCase());
              if (matchIn && (c.entity === 'EXIT' || c.type === 'READER')) {
                matchIn.gateStatus = 'RETURNED';
              }
            }
          });

          // Ensure checkins array contains ONLY real check-ins (returned assets or entry scans), excluding active check-outs
          const filteredCheckins = checkins.filter((c: any) => {
            if (!c) return false;
            const rawCust = (c.raw?.custodianName || c.entity || '').toLowerCase();
            const rawPurp = (c.raw?.purpose || '').toLowerCase();
            const rawNotes = (c.raw?.notes || '').toLowerCase();
            const rawStatus = (c.raw?.status || '').toLowerCase();

            const isRet = (c.raw?.actualReturnDate != null && c.raw?.actualReturnDate !== '') || rawStatus === 'returned' || rawStatus === 'completed' || c.gateStatus === 'RETURNED' || c.gateStatus === 'COMPLETED' || c.gateStatus === 'Matched';
            const isEntry = rawPurp.includes('entry') || rawCust.includes('entry') || rawNotes.includes('antenna 4') || c.entity === 'ENTRY';
            const isMissing = rawStatus === 'missing' || c.gateStatus === 'MISSING';

            // Filter out handheld checkout scans or active exit checkout scans!
            if ((rawCust.includes('operator') || rawCust.includes('handheld') || rawPurp.includes('handheld') || c.type === 'Handheld Reader' || c.entity === 'Handheld Reader') && !isRet && !isEntry && !isMissing) {
              return false;
            }
            if ((c.entity === 'EXIT' || rawCust === 'exit') && !isRet && !isEntry && !isMissing) {
              return false;
            }
            if (c.gateStatus === '-' && !isEntry && !isRet) {
              return false;
            }
            return isRet || isEntry || isMissing;
          });

          filteredCheckins.forEach((c: any) => {
            if (c.entity === 'ENTRY' || (c.raw && c.raw.purpose && c.raw.purpose.toLowerCase().includes('fixed')) || (c.raw && c.raw.custodianName && c.raw.custodianName.toLowerCase() === 'entry')) {
              c.type = 'READER';
            } else {
              c.type = 'Handheld Reader';
            }
          });

          this.checkoutRecords.set(checkouts);
          this.checkinRecords.set(filteredCheckins);
        },
        error: (err) => {
          console.error('Failed to fetch assignments', err);
        }
      });
    });
  }



  ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.buildCharts();
      
      // Start periodic real event polling from database!
      this.startRealEventPolling();

      // If active view is GPS Tracking, initialize Leaflet map
      if (this.activeNav() === 'GPS Tracking' || localStorage.getItem('activeNav') === 'GPS Tracking') {
        setTimeout(() => this.initSatelliteMap(), 300);
      }
    }
  }

  ngOnDestroy() {
    this.destroyCharts();
    if (this.realEventInterval) {
      clearInterval(this.realEventInterval);
    }
    if (this.simulationInterval) {
      clearInterval(this.simulationInterval);
    }
    if (this.auditInterval) {
      clearInterval(this.auditInterval);
    }
    if (this.scanSessionInterval) {
      clearInterval(this.scanSessionInterval);
    }
    if (this.scanTimerInterval) {
      clearInterval(this.scanTimerInterval);
    }
    if (this.gpsTimerInterval) {
      clearInterval(this.gpsTimerInterval);
    }
    this.stopAssignmentPolling();
    this.destroySatelliteMap();
  }

  // Action Methods
  protected onSignOut() {
    // 1. Immediately reset login signals and local storage for instant UI response
    this.isLoggedIn.set(false);
    this.loginUsername.set('');
    this.loginPassword.set('');
    this.stopAssignmentPolling();

    if (isPlatformBrowser(this.platformId)) {
      this.authService.clearStorage();
      localStorage.clear();
    }

    // 2. Best-effort API call to inform backend
    try {
      this.authService.logout().subscribe({
        next: () => {},
        error: () => {}
      });
    } catch {
      // Ignore network / auth errors on sign out
    }
  }


  protected onDateChange(newDate: string) {
    if (newDate) {
      this.selectedDate.set(newDate);
    }
  }

  protected selectOperation(op: string) {
    this.activeOperation.set(op);
  }

  protected selectNav(nav: string) {
    const item = this.filteredNavItems().find(n => n.name === nav);
    if (item?.submenus) {
      this.toggleExpanded(nav);
      this.activeNav.set(nav);
      if (item.submenus.length > 0 && !item.submenus.includes(this.activeSubNav())) {
        this.activeSubNav.set(item.submenus[0]);
      }
    } else {
      this.activeNav.set(nav);
      this.activeSubNav.set('');
    }
    this.isMobileSidebarOpen.set(false);
    
    if (nav === 'Maintenance' || nav === 'Dashboard' || nav === 'Reports & Analytics') {
      setTimeout(() => {
        this.destroyCharts();
        this.buildCharts();
      }, 100);
    }

    if (nav === 'Check in/Check out') {
      this.fetchAssignments();
      this.startAssignmentPolling();
    } else {
      this.stopAssignmentPolling();
    }

    if (nav === 'RFID Operations') {
      this.fetchTagsThenAssets();
      this.startScanSession();
    } else {
      this.stopScanSession();
    }

    if (nav === 'Dashboard') {
      this.loadAllApiData();
    } else if (nav === 'Assets') {
      this.selectedAsset.set(null); // Clear detail panel — only shows when user clicks a row
      this.fetchAssets();
    } else if (nav === 'GPS Tracking') {
      this.fetchLiveGpsLocations();
      if (this.gpsMapMode() === 'satellite') {
        // Wait for Angular @if block to render GPS section DOM before initializing Leaflet
        setTimeout(() => this.initSatelliteMap(), 500);
      }
    }
  }

  protected isExpanded(name: string): boolean {
    return !!this.expandedItems()[name];
  }

  protected toggleExpanded(name: string) {
    const current = this.expandedItems();
    this.expandedItems.set({
      ...current,
      [name]: !current[name]
    });
  }

  protected selectSubNav(sub: string, parentName: string) {
    this.activeSubNav.set(sub);
    this.activeNav.set(parentName);
    if (parentName === 'Assets') {
      this.fetchAssets();
    } else if (parentName === 'RFID Operations') {
      this.fetchTagsThenAssets();
      if (sub === 'Tag Management') {
        this.fetchTags();
      }
      if (sub === 'Scan Session Monitor') {
        this.startScanSession();
      } else {
        this.stopScanSession();
      }
      if (sub === 'Handheld Sessions') {
        this.fetchHandheldSessions();
      }
      if (sub === 'RFID Events') {
        this.fetchRfidEvents();
      }
    } else {
      this.stopScanSession();
    }
  }

  protected toggleNotificationDropdown() {
    this.isNotificationOpen.update(v => !v);
    this.isSiteDropdownOpen.set(false);
  }

  protected closeDropdowns() {
    this.isSiteDropdownOpen.set(false);
    this.isNotificationOpen.set(false);
  }

  protected onSearch(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  protected toggleTheme() {
    const nextTheme = this.currentTheme() === 'light' ? 'dark' : 'light';
    this.currentTheme.set(nextTheme);
    if (isPlatformBrowser(this.platformId)) {
      document.documentElement.setAttribute('data-theme', nextTheme);
      // Rebuild charts to update text colors
      this.destroyCharts();
      this.buildCharts();
    }
  }

  protected triggerRefresh() {
    this.isLoading.set(true);
    this.loadAllApiData();
    setTimeout(() => {
      this.isLoading.set(false);
    }, 800);
  }

  protected clearNotifications() {
    this.notifications.set([]);
  }

  protected markNotificationsRead() {
    this.notifications.update(list => list.map(n => ({ ...n, read: true })));
  }

  // Real Event Polling
  private realEventInterval: any;
  private startRealEventPolling() {
    this.fetchRealEvents();
    this.realEventInterval = setInterval(() => {
      this.fetchRealEvents();
    }, 5000);
  }

  // Simulation of live events
  private simulationInterval: any;
  private startEventSimulation() {
    const locations = {
      'Pune DC': ['Pune DC - Gate 2', 'Pune DC Yard', 'Pune DC - IT Store', 'Pune DC - Zone B'],
      'Mumbai Warehouse': ['Mumbai Warehouse - Dock 4', 'Mumbai Highway NH48', 'Mumbai Store'],
      'Chennai Plant': ['Chennai Plant - Workshop', 'Chennai Plant Gate 1'],
      'Bengaluru Hub': ['Bengaluru Hub - Gate 1', 'Bengaluru Hub Yard']
    } as Record<string, string[]>;

    const operators = ['Amit Verma', 'System', 'Rohan Sharma', 'System', 'Karan Johar', 'System'];
    const assetCategories = [
      { cat: 'Returnable Container', name: 'Returnable Container - RC', prefix: 'AST-TRC-' },
      { cat: 'Material Handling', name: 'Forklift - FLT', prefix: 'VEH-MH-' },
      { cat: 'IT Assets', name: 'Laptop - LT-', prefix: 'AST-IT-' },
      { cat: 'Tools & Equipment', name: 'Welding Machine - WM-', prefix: 'AST-TL-' },
      { cat: 'Vehicles', name: 'Delivery Truck - DL', prefix: 'VEH-DL-' }
    ];

    this.simulationInterval = setInterval(() => {
      // 30% chance to spawn an event every 5 seconds
      if (Math.random() > 0.6) {
        const site = this.selectedSite() === 'All Sites' ? 'Pune DC' : this.selectedSite();
        const siteLocs = locations[site] || ['Pune DC - Gate 2'];
        const loc = siteLocs[Math.floor(Math.random() * siteLocs.length)];
        
        const catObj = assetCategories[Math.floor(Math.random() * assetCategories.length)];
        const op = operators[Math.floor(Math.random() * operators.length)];
        const idNum = Math.floor(1000 + Math.random() * 9000);
        const assetId = `${catObj.prefix}${idNum}`;
        const assetName = `${catObj.name}${Math.floor(10 + Math.random() * 90)}`;
        
        const types: ('RFID Read' | 'GPS Ping' | 'Exception')[] = ['RFID Read', 'GPS Ping', 'Exception'];
        // Weighted selection: RFID/GPS is 90% common, Exception 10%
        const randVal = Math.random();
        const type = randVal < 0.45 ? types[0] : (randVal < 0.9 ? types[1] : types[2]);
        
        let details = '';
        let source = '';
        if (type === 'RFID Read') {
          const gates = ['IN Reader: GATE_IN', 'OUT Reader: GATE_OUT', 'Handheld: H_READ_1'];
          details = gates[Math.floor(Math.random() * gates.length)];
          source = details.includes('Handheld') ? 'Handheld Reader' : 'Fixed Reader';
        } else if (type === 'GPS Ping') {
          const lat = (18.5 + Math.random() * 0.5).toFixed(4);
          const lng = (73.7 + Math.random() * 0.5).toFixed(4);
          details = `Lat: ${lat}, Long: ${lng}`;
          source = 'GPS Device';
        } else {
          const exceptions = ['Unauthorized Zone Entry', 'Missing Read Event on Exit', 'Low Battery Threshold reached'];
          details = exceptions[Math.floor(Math.random() * exceptions.length)];
          source = details.includes('Battery') ? 'GPS Device' : 'RFID Reader';
          
          // Add notification for exceptions
          const newNotif = {
            text: `Alert: ${details} for ${assetName} at ${loc}`,
            time: 'Just now',
            read: false,
            type: details.includes('Battery') || details.includes('Missing') ? 'warning' : 'danger'
          };
          this.notifications.update(n => [newNotif, ...n]);
        }

        const now = new Date();
        const timeStr = now.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + now.toLocaleTimeString('en-US', { hour12: true });

        const newEvent: EventItem = {
          id: assetId,
          time: timeStr,
          type,
          assetId,
          assetName,
          category: catObj.cat,
          location: loc,
          details,
          source,
          operator: op
        };

        // Prepend to event list (limit list to 15 items)
        this.allEvents.update(evs => [newEvent, ...evs.slice(0, 14)]);
        
        // Bump site stats slightly in siteData
        const selSite = this.selectedSite();
        const s = this.siteData[selSite] || this.siteData['Pune DC'];
        let rfidCount = s.rfidReadsToday;
        let gpsCount = s.gpsPingsToday;
        let excCount = s.exceptionAlerts;
        
        if (type === 'RFID Read') rfidCount += 1;
        else if (type === 'GPS Ping') gpsCount += 1;
        else excCount += 1;
        
        this.siteData[selSite] = {
          ...s,
          rfidReadsToday: rfidCount,
          gpsPingsToday: gpsCount,
          exceptionAlerts: excCount
        };
      }
    }, 6000);
  }

  // Filtered Events computed helper
  protected get filteredEvents(): EventItem[] {
    const q = this.searchQuery().toLowerCase();
    const site = this.selectedSite();
    const events = this.allEvents();

    if (!events || events.length === 0) return [];
    
    return events.filter(ev => {
      // 1. Filter by Selected Site
      if (site && site !== 'All Sites') {
        const evLoc = (ev.location || '').toLowerCase();
        const evSource = (ev.source || '').toLowerCase();
        const siteLower = site.toLowerCase();
        
        const matchesSite = evLoc.includes(siteLower) || 
                            evSource.includes(siteLower) || 
                            (siteLower.includes('pune') && (evLoc.includes('pune') || evLoc.includes('zone') || evLoc.includes('gate'))) ||
                            (siteLower.includes('chennai') && (evLoc.includes('chennai') || evLoc.includes('mfg') || evLoc.includes('plant'))) ||
                            (siteLower.includes('mumbai') && (evLoc.includes('mumbai') || evLoc.includes('wh') || evLoc.includes('warehouse'))) ||
                            (siteLower.includes('bengaluru') && (evLoc.includes('bengaluru') || evLoc.includes('hub'))) ||
                            (siteLower.includes('delhi') && (evLoc.includes('delhi') || evLoc.includes('ncr'))) ||
                            (siteLower.includes('hyderabad') && (evLoc.includes('hyderabad') || evLoc.includes('dc')));
        if (!matchesSite) return false;
      }

      // 2. Filter by Search Query
      const matchesSearch = !q || 
        (ev.assetId && ev.assetId.toLowerCase().includes(q)) ||
        (ev.assetName && ev.assetName.toLowerCase().includes(q)) ||
        (ev.location && ev.location.toLowerCase().includes(q)) ||
        (ev.category && ev.category.toLowerCase().includes(q)) ||
        (ev.operator && ev.operator.toLowerCase().includes(q)) ||
        (ev.details && ev.details.toLowerCase().includes(q));
        
      if (!matchesSearch) return false;
      return true;
    });
  }

  // Chart Building Logic
  private buildCharts() {
    const stats = this.currentStats();
    const isDark = this.currentTheme() === 'dark';
    
    // If charts already exist, update dataset values smoothly without destroying canvas context
    if (this.charts['statusByCategory']) {
      try {
        if (this.charts['statusByCategory']) {
          this.charts['statusByCategory'].data.datasets[0].data = stats.statusCategory;
          this.charts['statusByCategory'].update('none');
        }
        if (this.charts['utilizationOverTime']) {
          this.charts['utilizationOverTime'].data.datasets[0].data = stats.utilizationOverTime;
          this.charts['utilizationOverTime'].update('none');
        }
        if (this.charts['movementTrends']) {
          this.charts['movementTrends'].data.datasets[0].data = stats.movementInbound;
          this.charts['movementTrends'].data.datasets[1].data = stats.movementOutbound;
          this.charts['movementTrends'].data.datasets[2].data = stats.movementUtilization;
          this.charts['movementTrends'].update('none');
        }
        if (this.charts['topCategories']) {
          this.charts['topCategories'].data.datasets[0].data = stats.topCategories;
          this.charts['topCategories'].update('none');
        }
        return;
      } catch (e) {
        // Fallback to destroy and rebuild if update fails
      }
    }

    // Destroy existing charts to avoid "Canvas is already in use" errors
    Object.keys(this.charts).forEach(key => {
      if (this.charts[key]) {
        try {
          this.charts[key].destroy();
        } catch (e) {}
      }
    });
    this.charts = {};
    
    const textColor = isDark ? '#94a3b8' : '#64748b';
    const gridColor = isDark ? '#1e293b' : '#f1f5f9';
    const accentTeal = '#00b4d8';
    const accentBlue = '#3b82f6';
    const accentGreen = '#10b981';
    const accentWarning = '#f59e0b';
    const accentPurple = '#8b5cf6';
    const accentRed = '#ef4444';
    const accentOrange = '#f97316';

    // -------------------------------------------------------------
    // Sparkline Charts
    // -------------------------------------------------------------
    const sparklineConfig = (data: number[], color: string) => ({
      type: 'line' as const,
      data: {
        labels: ['', '', '', '', '', '', ''],
        datasets: [{
          data,
          borderColor: color,
          borderWidth: 1.5,
          pointRadius: 0,
          fill: true,
          backgroundColor: color === accentGreen ? 'rgba(16, 185, 129, 0.05)' :
                           color === accentBlue ? 'rgba(59, 130, 246, 0.05)' :
                           color === accentTeal ? 'rgba(0, 180, 216, 0.05)' :
                           'rgba(0, 180, 216, 0.05)',
          tension: 0.4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false }
        }
      }
    });

    if (this.utilizationSparklineCanvas) {
      this.charts['spark1'] = new Chart(
        this.utilizationSparklineCanvas.nativeElement,
        sparklineConfig(stats.utilizationSpark, accentTeal)
      );
    }
    if (this.accuracySparklineCanvas) {
      this.charts['spark2'] = new Chart(
        this.accuracySparklineCanvas.nativeElement,
        sparklineConfig(stats.accuracySpark, accentGreen)
      );
    }
    if (this.savingsSparklineCanvas) {
      this.charts['spark3'] = new Chart(
        this.savingsSparklineCanvas.nativeElement,
        sparklineConfig(stats.savingsSpark, accentBlue)
      );
    }
    if (this.turnaroundSparklineCanvas) {
      this.charts['spark4'] = new Chart(
        this.turnaroundSparklineCanvas.nativeElement,
        sparklineConfig(stats.turnaroundSpark, accentTeal)
      );
    }

    const last7DaysLabels = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      last7DaysLabels.push(d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }));
    }

    const last6MonthsLabels = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      last6MonthsLabels.push(d.toLocaleDateString('en-US', { month: 'short' }));
    }

    // -------------------------------------------------------------
    // Chart 1: Asset Utilization Over Time (Line)
    // -------------------------------------------------------------
    if (this.utilizationOverTimeCanvas) {
      this.charts['utilizationOverTime'] = new Chart(this.utilizationOverTimeCanvas.nativeElement, {
        type: 'line',
        data: {
          labels: last7DaysLabels,
          datasets: [{
            label: 'Utilization %',
            data: stats.utilizationOverTime,
            borderColor: accentTeal,
            backgroundColor: 'rgba(0, 180, 216, 0.1)',
            fill: true,
            tension: 0.35,
            borderWidth: 2.5,
            pointBackgroundColor: accentTeal,
            pointBorderColor: isDark ? '#151c2c' : '#ffffff',
            pointBorderWidth: 2,
            pointRadius: 4,
            pointHoverRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              padding: 12,
              cornerRadius: 8,
              backgroundColor: isDark ? '#070a12' : '#0b1a30',
              titleFont: { family: 'Plus Jakarta Sans', weight: 'bold' },
              bodyFont: { family: 'Inter' }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor, font: { family: 'Inter', size: 10 } }
            },
            y: {
              min: 0,
              max: 100,
              border: { dash: [4, 4] },
              grid: { color: gridColor },
              ticks: { 
                color: textColor, 
                font: { family: 'Inter', size: 10 },
                stepSize: 25,
                callback: (val) => val + '%'
              }
            }
          }
        }
      });
    }

    // -------------------------------------------------------------
    // Chart 2: Asset Status by Category (Donut)
    // -------------------------------------------------------------
    if (this.statusByCategoryCanvas) {
      const statusLabels = ['In Use', 'Available', 'Maintenance', 'Checked-Out', 'Retired'];
      this.charts['statusByCategory'] = new Chart(this.statusByCategoryCanvas.nativeElement, {
        type: 'doughnut',
        data: {
          labels: statusLabels,
          datasets: [{
            data: stats.statusCategory,
            backgroundColor: [accentTeal, accentGreen, accentWarning, accentOrange, accentPurple],
            borderWidth: isDark ? 2 : 1,
            borderColor: isDark ? '#151c2c' : '#ffffff',
            hoverOffset: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '72%',
          plugins: {
            legend: { display: false },
            tooltip: {
              padding: 12,
              cornerRadius: 8,
              backgroundColor: isDark ? '#070a12' : '#0b1a30',
              titleFont: { family: 'Plus Jakarta Sans', weight: 'bold' },
              bodyFont: { family: 'Inter' },
              callbacks: {
                label: (context) => {
                  const val = context.raw as number;
                  const total = stats.statusCategory.reduce((a, b) => a + b, 0);
                  const pct = total > 0 ? ((val / total) * 100).toFixed(1) : '0';
                  return ` ${context.label}: ${val.toLocaleString()} (${pct}%)`;
                }
              }
            }
          }
        }
      });
    }

    // -------------------------------------------------------------
    // Chart 3: Monthly Movement Trends (Bar & Line Combo)
    // -------------------------------------------------------------
    if (this.movementTrendsCanvas) {
      this.charts['movementTrends'] = new Chart(this.movementTrendsCanvas.nativeElement, {
        type: 'bar',
        data: {
          labels: last6MonthsLabels,
          datasets: [
            {
              type: 'bar' as const,
              label: 'Inbound',
              data: stats.movementInbound,
              backgroundColor: accentGreen,
              borderRadius: 4,
              barThickness: 10,
              yAxisID: 'y'
            },
            {
              type: 'bar' as const,
              label: 'Outbound',
              data: stats.movementOutbound,
              backgroundColor: accentBlue,
              borderRadius: 4,
              barThickness: 10,
              yAxisID: 'y'
            },
            {
              type: 'line' as const,
              label: 'Utilization %',
              data: stats.movementUtilization,
              borderColor: accentTeal,
              borderWidth: 2,
              pointRadius: 3,
              pointBackgroundColor: accentTeal,
              tension: 0.4,
              yAxisID: 'y1'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              padding: 12,
              cornerRadius: 8,
              backgroundColor: isDark ? '#070a12' : '#0b1a30',
              titleFont: { family: 'Plus Jakarta Sans', weight: 'bold' },
              bodyFont: { family: 'Inter' }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: textColor, font: { family: 'Inter', size: 9 } }
            },
            y: {
              position: 'left',
              border: { dash: [4, 4] },
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: 'Inter', size: 9 },
                callback: (val) => {
                  const num = val as number;
                  return num >= 1000 ? (num / 1000) + 'K' : num;
                }
              }
            },
            y1: {
              position: 'right',
              grid: { display: false },
              min: 0,
              max: 100,
              ticks: {
                color: textColor,
                font: { family: 'Inter', size: 9 },
                callback: (val) => val + '%'
              }
            }
          }
        }
      });
    }

    // -------------------------------------------------------------
    // Chart 4: Top Asset Categories (Horizontal Bar)
    // -------------------------------------------------------------
    if (this.topCategoriesCanvas) {
      this.charts['topCategories'] = new Chart(this.topCategoriesCanvas.nativeElement, {
        type: 'bar',
        data: {
          labels: ['Returnable Containers', 'Material Handling', 'Tools & Equipment', 'IT Assets', 'Vehicles', 'Others'],
          datasets: [{
            data: stats.topCategories,
            backgroundColor: accentBlue,
            borderRadius: 4,
            barThickness: 8
          }]
        },
        plugins: [{
          id: 'barLabels',
          afterDatasetsDraw(chart) {
            const { ctx, data } = chart;
            ctx.save();
            ctx.font = 'bold 9px Inter';
            ctx.fillStyle = isDark ? '#cbd5e1' : '#1e293b';
            const dataset = data.datasets[0];
            const meta = chart.getDatasetMeta(0);
            meta.data.forEach((bar, index) => {
              const val = dataset.data[index] as number;
              const total = dataset.data.reduce((a: any, b: any) => a + b, 0) as number;
              const pct = ((val / total) * 100).toFixed(1);
              const text = `${val.toLocaleString()} (${pct}%)`;
              const x = bar.x + 8;
              const y = bar.y + 3; // center vertically
              ctx.fillText(text, x, y);
            });
            ctx.restore();
          }
        }],
        options: {
          indexAxis: 'y' as const,
          responsive: true,
          maintainAspectRatio: false,
          layout: {
            padding: {
              right: 80
            }
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              padding: 12,
              cornerRadius: 8,
              backgroundColor: isDark ? '#070a12' : '#0b1a30',
              titleFont: { family: 'Plus Jakarta Sans', weight: 'bold' },
              bodyFont: { family: 'Inter' },
              callbacks: {
                label: (context) => {
                  const val = context.raw as number;
                  const total = stats.topCategories.reduce((a, b) => a + b, 0);
                  const pct = ((val / total) * 100).toFixed(1);
                  return ` ${val.toLocaleString()} (${pct}%)`;
                }
              }
            }
          },
          scales: {
            x: {
              border: { dash: [4, 4] },
              grid: { color: gridColor },
              ticks: {
                color: textColor,
                font: { family: 'Inter', size: 9 },
                callback: (val) => {
                  const num = val as number;
                  return num >= 1000 ? (num / 1000) + 'K' : num;
                }
              }
            },
            y: {
              grid: { display: false },
              ticks: { color: textColor, font: { family: 'Inter', size: 10 } }
            }
          }
        }
      });
    }

    if (this.maintHealthTrendCanvas) {
      this.charts['maintHealthTrend'] = new Chart(this.maintHealthTrendCanvas.nativeElement, {
        type: 'line',
        data: {
          labels: ['20 Apr', '27 Apr', '4 May', '11 May', '18 May'],
          datasets: [
            { label: 'RFID Tags', data: [81, 83, 80, 82, 80], borderColor: accentBlue, backgroundColor: 'transparent', tension: 0.35, borderWidth: 2, pointRadius: 3 },
            { label: 'GPS Trackers', data: [76, 74, 76, 72, 71], borderColor: accentGreen, backgroundColor: 'transparent', tension: 0.35, borderWidth: 2, pointRadius: 3 },
            { label: 'Forklifts', data: [45, 52, 48, 45, 43], borderColor: accentWarning, backgroundColor: 'transparent', tension: 0.35, borderWidth: 2, pointRadius: 3 },
            { label: 'Tools', data: [38, 39, 36, 35, 34], borderColor: accentPurple, backgroundColor: 'transparent', tension: 0.35, borderWidth: 2, pointRadius: 3 },
            { label: 'Mobile Assets', data: [31, 28, 29, 27, 28], borderColor: accentTeal, backgroundColor: 'transparent', tension: 0.35, borderWidth: 2, pointRadius: 3 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: textColor, font: { family: 'Inter', size: 9 } } },
            y: { min: 0, max: 100, border: { dash: [4, 4] }, grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Inter', size: 9 } } }
          }
        }
      });
    }

    if (this.maintAlertDistributionCanvas) {
      this.charts['maintAlertDistribution'] = new Chart(this.maintAlertDistributionCanvas.nativeElement, {
        type: 'doughnut',
        data: {
          labels: ['RFID Tags', 'GPS Trackers', 'Forklifts', 'Tools', 'Mobile Assets'],
          datasets: [{
            data: [36, 28, 22, 18, 16],
            backgroundColor: [accentBlue, accentGreen, accentWarning, accentPurple, accentTeal],
            borderWidth: isDark ? 2 : 1,
            borderColor: isDark ? '#151c2c' : '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '70%',
          plugins: { legend: { display: false } }
        }
      });
    }

    // -------------------------------------------------------------
    // Reports & Analytics Charts
    // -------------------------------------------------------------
    if (this.reportsInventoryAccuracyCanvas && this.reportsInventoryAccuracyCanvas.nativeElement) {
      this.charts['reportsInventoryAccuracy'] = new Chart(this.reportsInventoryAccuracyCanvas.nativeElement, {
        type: 'line',
        data: {
          labels: ['1 May', '5 May', '9 May', '13 May', '17 May', '20 May'],
          datasets: [{
            label: 'Inventory Accuracy (%)',
            data: [81, 86, 84, 86, 88, 91],
            borderColor: '#10b981',
            backgroundColor: 'transparent',
            tension: 0.35,
            borderWidth: 2.5,
            pointRadius: 4,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#10b981',
            pointBorderWidth: 2,
            fill: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: textColor, font: { family: 'Inter', size: 9 } } },
            y: { min: 70, max: 100, border: { dash: [4, 4] }, grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Inter', size: 9 }, stepSize: 5 } }
          }
        }
      });
    }

    if (this.reportsAssetsByCategoryCanvas && this.reportsAssetsByCategoryCanvas.nativeElement) {
      this.charts['reportsAssetsByCategory'] = new Chart(this.reportsAssetsByCategoryCanvas.nativeElement, {
        type: 'doughnut',
        data: {
          labels: ['IT Assets', 'Material Handling', 'Vehicles', 'Tools & Equipment', 'RFID Tags', 'Others'],
          datasets: [{
            data: [6842, 5621, 4567, 3215, 2489, 2024],
            backgroundColor: ['#0066ff', '#ec4899', '#10b981', '#00b4d8', '#00f5d4', '#f97316'],
            borderWidth: isDark ? 2 : 1,
            borderColor: isDark ? '#151c2c' : '#ffffff'
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '72%',
          plugins: { legend: { display: false } }
        }
      });
    }

    if (this.reportsZoneOccupancyCanvas && this.reportsZoneOccupancyCanvas.nativeElement) {
      this.charts['reportsZoneOccupancy'] = new Chart(this.reportsZoneOccupancyCanvas.nativeElement, {
        type: 'bar',
        data: {
          labels: ['Pune DC', 'Mumbai WH', 'Chennai Plant', 'Bengaluru Hub', 'Delhi NCR', 'Hyderabad DC'],
          datasets: [{
            label: 'Occupancy (%)',
            data: [72, 68, 85, 61, 74, 63],
            backgroundColor: '#00b4d8',
            borderRadius: 4,
            barThickness: 16
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: textColor, font: { family: 'Inter', size: 9 } } },
            y: { min: 0, max: 100, border: { dash: [4, 4] }, grid: { color: gridColor }, ticks: { color: textColor, font: { family: 'Inter', size: 9 }, stepSize: 20 } }
          }
        }
      });
    }
  }

  protected alert(message: string) {
    if (isPlatformBrowser(this.platformId)) {
      window.alert(message);
    }
  }

  protected removeSpare(alertObj: MaintenanceAlert, spare: string) {
    if (alertObj.spares) {
      alertObj.spares = alertObj.spares.filter(s => s !== spare);
    }
  }

  protected addSpare(alertObj: MaintenanceAlert, event: Event) {
    const select = event.target as HTMLSelectElement;
    const value = select.value;
    if (value) {
      if (!alertObj.spares) {
        alertObj.spares = [];
      }
      if (!alertObj.spares.includes(value)) {
        alertObj.spares.push(value);
      }
      select.value = ''; // reset select
    }
  }

  private destroyCharts() {
    Object.keys(this.charts).forEach(key => {
      if (this.charts[key]) {
        this.charts[key].destroy();
      }
    });
    this.charts = {};
  }

  // Reports & Analytics Interactive Actions
  protected reportsToggleExpandSite(site: string) {
    this.reportsExpandedSites.update(map => ({
      ...map,
      [site]: !map[site]
    }));
  }

  protected reportsExpandAll() {
    this.reportsExpandedSites.set({
      'India Operations (All Sites)': true,
      'Pune DC': true,
      'Mumbai Warehouse': true,
      'Chennai Plant': true,
      'Bengaluru Hub': true,
      'Delhi NCR': true,
      'Hyderabad DC': true
    });
  }

  protected reportsCollapseAll() {
    this.reportsExpandedSites.set({});
  }

  protected applyReportsFilters() {
    this.isLoading.set(true);
    setTimeout(() => {
      this.reportsDataRefreshedTime.set(new Date().toLocaleString());
      this.destroyCharts();
      this.buildCharts();
      this.isLoading.set(false);
    }, 600);
  }

  protected toggleReportsDatePicker() {
    this.isReportsDatePickerOpen.update(v => !v);
  }

  protected setReportsDatePreset(preset: 'today' | 'week' | 'month' | 'last30') {
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];
    
    if (preset === 'today') {
      this.reportsStartDate.set(todayStr);
      this.reportsEndDate.set(todayStr);
    } else if (preset === 'week') {
      const weekAgo = new Date();
      weekAgo.setDate(today.getDate() - 7);
      this.reportsStartDate.set(weekAgo.toISOString().split('T')[0]);
      this.reportsEndDate.set(todayStr);
    } else if (preset === 'month') {
      const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
      this.reportsStartDate.set(startOfMonth.toISOString().split('T')[0]);
      this.reportsEndDate.set(todayStr);
    } else if (preset === 'last30') {
      const thirtyAgo = new Date();
      thirtyAgo.setDate(today.getDate() - 30);
      this.reportsStartDate.set(thirtyAgo.toISOString().split('T')[0]);
      this.reportsEndDate.set(todayStr);
    }
  }

  protected applyCustomDateRange() {
    this.isReportsDatePickerOpen.set(false);
    this.applyReportsFilters();
  }

  protected resetReportsFilters() {
    const today = new Date();
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    this.reportsStartDate.set(startOfMonth.toISOString().split('T')[0]);
    this.reportsEndDate.set(today.toISOString().split('T')[0]);
    this.reportsSelectedSite.set('All Sites');
    this.reportsSelectedCategory.set('All Categories');
    this.reportsSelectedDepartment.set('All Departments');
    this.reportsSelectedCustomerVendor.set('All');
    this.applyReportsFilters();
  }

  protected openScheduleEmailModal() {
    this.isScheduleEmailModalOpen.set(true);
  }

  protected closeScheduleEmailModal() {
    this.isScheduleEmailModalOpen.set(false);
  }

  protected submitScheduleEmail() {
    this.isScheduleEmailModalOpen.set(false);
    alert(`Email Schedule configured successfully for ${this.scheduleEmailAddress()} (${this.scheduleEmailFrequency()} - ${this.scheduleEmailFormat()})!`);
  }

  protected openShareModal() {
    this.shareLinkCopied.set(false);
    this.isShareModalOpen.set(true);
  }

  protected closeShareModal() {
    this.isShareModalOpen.set(false);
  }

  protected copyShareLink() {
    if (isPlatformBrowser(this.platformId)) {
      try {
        navigator.clipboard.writeText(window.location.href);
      } catch (e) {}
      this.shareLinkCopied.set(true);
      setTimeout(() => this.shareLinkCopied.set(false), 3000);
    }
  }

  // Export full reports dashboard container to PDF using html2canvas and jsPDF
  protected async exportReportsPDF() {
    if (!isPlatformBrowser(this.platformId)) return;
    this.isLoading.set(true);
    try {
      const element = document.getElementById('reports-view-container');
      if (!element) {
        window.alert('Reports dashboard container element not found!');
        return;
      }
      
      const isDark = this.currentTheme() === 'dark';
      const bgColor = isDark ? '#0f172a' : '#f8fafc';
      
      const canvas = await html2canvas(element, {
        scale: 1.5,
        useCORS: true,
        backgroundColor: bgColor
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [canvas.width, canvas.height]
      });
      
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save('Reports_and_Analytics_Dashboard.pdf');
    } catch (err) {
      console.error('PDF export failed:', err);
      window.alert('Failed to export PDF: ' + err);
    } finally {
      this.isLoading.set(false);
    }
  }

  // Export table summary data to Excel using XLSX
  protected exportReportsExcel() {
    if (!isPlatformBrowser(this.platformId)) return;
    
    const data = [
      ['Site', 'Asset Category', 'Total Assets (Count)', 'Total Assets (%)', 'Active Assets (Count)', 'Active Assets (%)', 'Idle Assets (Count)', 'Idle Assets (%)', 'Lost Assets (Count)', 'Lost Assets (%)', 'Inventory Accuracy (%)', 'Utilization (%)', 'Avg. Turnaround (Days)']
    ];
    
    const rows = [
      { name: 'India Operations (All Sites)', count: 24758, active: 22341, idle: 1487, lost: 76, accuracy: 94.3, utilization: 68.0, turnaround: 1.6, pct: 100 },
      { name: 'Pune DC', count: 4560, active: 4112, idle: 388, lost: 60, accuracy: 93.6, utilization: 72.0, turnaround: 1.4, pct: 18.4 },
      { name: 'Mumbai Warehouse', count: 5921, active: 5298, idle: 561, lost: 62, accuracy: 95.1, utilization: 68.0, turnaround: 1.7, pct: 23.9 },
      { name: 'Chennai Plant', count: 4128, active: 3812, idle: 256, lost: 60, accuracy: 95.6, utilization: 85.0, turnaround: 1.2, pct: 16.7 },
      { name: 'Bengaluru Hub', count: 3842, active: 3452, idle: 330, lost: 60, accuracy: 93.2, utilization: 61.0, turnaround: 1.8, pct: 15.5 },
      { name: 'Delhi NCR', count: 3657, active: 3276, idle: 321, lost: 58, accuracy: 92.8, utilization: 74.0, turnaround: 1.6, pct: 14.8 },
      { name: 'Hyderabad DC', count: 2650, active: 2391, idle: 211, lost: 56, accuracy: 94.1, utilization: 63.0, turnaround: 1.5, pct: 10.7 }
    ];
    
    rows.forEach(r => {
      data.push([
        r.name,
        'All Categories',
        r.count.toString(),
        r.pct + '%',
        r.active.toString(),
        ((r.active/r.count)*100).toFixed(1) + '%',
        r.idle.toString(),
        ((r.idle/r.count)*100).toFixed(1) + '%',
        r.lost.toString(),
        ((r.lost/r.count)*100).toFixed(1) + '%',
        r.accuracy + '%',
        r.utilization + '%',
        r.turnaround.toString()
      ]);
      
      // Expand categories if matching Expanded status
      if (this.reportsExpandedSites()[r.name]) {
        const categories = [
          { name: 'IT Assets', countPct: 0.276, activePct: 0.91, idlePct: 0.06, lostPct: 0.03, accuracy: 95.2, utilization: 74.0, turnaround: 1.2 },
          { name: 'Material Handling', countPct: 0.227, activePct: 0.89, idlePct: 0.09, lostPct: 0.02, accuracy: 93.8, utilization: 62.0, turnaround: 2.1 },
          { name: 'Vehicles', countPct: 0.185, activePct: 0.92, idlePct: 0.07, lostPct: 0.01, accuracy: 94.5, utilization: 78.0, turnaround: 1.5 },
          { name: 'Tools & Equipment', countPct: 0.13, activePct: 0.88, idlePct: 0.10, lostPct: 0.02, accuracy: 92.1, utilization: 55.0, turnaround: 2.5 },
          { name: 'RFID Tags', countPct: 0.101, activePct: 0.95, idlePct: 0.04, lostPct: 0.01, accuracy: 98.4, utilization: 92.0, turnaround: 0.5 },
          { name: 'Others', countPct: 0.081, activePct: 0.85, idlePct: 0.12, lostPct: 0.03, accuracy: 91.0, utilization: 50.0, turnaround: 3.0 }
        ];
        
        categories.forEach(c => {
          const cCount = Math.round(r.count * c.countPct);
          const cActive = Math.round(cCount * c.activePct);
          const cIdle = Math.round(cCount * c.idlePct);
          const cLost = cCount - cActive - cIdle;
          data.push([
            '',
            c.name,
            cCount.toString(),
            (c.countPct * 100).toFixed(1) + '%',
            cActive.toString(),
            (c.activePct * 100).toFixed(1) + '%',
            cIdle.toString(),
            (c.idlePct * 100).toFixed(1) + '%',
            cLost.toString(),
            ((cLost/cCount)*100).toFixed(1) + '%',
            c.accuracy + '%',
            c.utilization + '%',
            c.turnaround.toString()
          ]);
        });
      }
    });
    
    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Asset_Summary');
    XLSX.writeFile(wb, 'Asset_Summary_Report.xlsx');
  }

  // Download a high-fidelity PDF/Excel of a specific report library item
  protected downloadReport(reportName: string, format: 'pdf' | 'excel') {
    if (!isPlatformBrowser(this.platformId)) return;

    if (format === 'excel') {
      let endpoint = 'assets';
      if (reportName === 'Inventory Accuracy' || reportName === 'Zone Occupancy') endpoint = 'inventory';
      else if (reportName === 'Check-In / Check-Out Report' || reportName === 'Movement History') endpoint = 'movements';
      else if (reportName === 'GPS Route Summary') endpoint = 'gps';
      else if (reportName === 'Reader Performance' || reportName === 'Tag Read Accuracy') endpoint = 'rfid';
      else if (reportName === 'User Activity') endpoint = 'users';

      this.apiService.downloadReport(endpoint).subscribe({
        next: async (blob) => {
          try {
            const csvText = await blob.text();
            const wb = XLSX.read(csvText, { type: 'string', raw: true });
            
            // Adjust column widths for better display
            if (wb.SheetNames.length > 0) {
              const ws = wb.Sheets[wb.SheetNames[0]];
              const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
              const wscols = [];
              for (let col = range.s.c; col <= range.e.c; col++) {
                wscols.push({ wch: 22 });
              }
              ws['!cols'] = wscols;
            }
            
            XLSX.writeFile(wb, `${reportName.replace(/\s+/g, '_')}_Report.xlsx`);
          } catch (err) {
            console.error('Failed to convert CSV to Excel, falling back to raw download', err);
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${reportName.replace(/\s+/g, '_')}_Report.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(url);
          }
        },
        error: (err) => {
          console.error('Failed to download report', err);
        }
      });
      return;
    }
    
    let headers: string[] = [];
    let rows: string[][] = [];
    
    if (reportName === 'Inventory Accuracy') {
      headers = ['Site', 'Zone', 'RFID Expected Count', 'RFID Read Count', 'Variance', 'Accuracy (%)', 'Auditor'];
      rows = [
        ['Pune DC', 'Dock Door A', '125', '124', '-1', '99.2%', 'R. Kumar'],
        ['Pune DC', 'Aisle 4', '542', '538', '-4', '99.2%', 'R. Kumar'],
        ['Mumbai Warehouse', 'Receiving Bay', '224', '221', '-3', '98.6%', 'P. Patel'],
        ['Chennai Plant', 'Staging Zone', '180', '180', '0', '100.0%', 'A. Selvam'],
        ['Bengaluru Hub', 'Buffer Yard', '412', '398', '-14', '96.6%', 'M. Gowda'],
        ['Delhi NCR', 'Sorting Area', '320', '311', '-9', '97.2%', 'V. Sharma']
      ];
    } else if (reportName === 'Asset Utilization') {
      headers = ['Asset ID', 'Category', 'Site', 'Runtime (Hrs)', 'Idle (Hrs)', 'Total Active Time (%)', 'Alerts Triggered'];
      rows = [
        ['FL-0098', 'Forklift', 'Pune DC', '142.5', '24.1', '85.5%', '2'],
        ['FL-0099', 'Forklift', 'Pune DC', '128.0', '36.5', '77.8%', '0'],
        ['TR-102', 'Terminal Tractor', 'Mumbai WH', '98.4', '62.0', '61.3%', '5'],
        ['CG-556', 'Container Gantry', 'Chennai Plant', '182.3', '10.5', '94.5%', '1'],
        ['PC-092', 'Platform Cart', 'Bengaluru Hub', '32.1', '128.5', '19.9%', '0'],
        ['FL-0100', 'Forklift', 'Delhi NCR', '110.4', '42.0', '72.4%', '3']
      ];
    } else if (reportName === 'Check-In / Check-Out Report') {
      headers = ['Timestamp', 'Asset ID', 'Category', 'Custodian', 'Event Type', 'Destination Site', 'Status'];
      rows = [
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '10:14:02'), 'RM-COIL-402', 'Raw Material', 'Amit Sharma', 'Check-In', 'Pune DC', 'Success'],
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '09:42:15'), 'FL-0098', 'Forklift', 'Rajesh Kumar', 'Check-Out', 'Maintenance Bay', 'Success'],
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '08:31:50',), 'TR-102', 'Trailer', 'Deepak Patil', 'Check-Out', 'Delhi NCR Route', 'Success'],
        [this.getRelativeDateStr(-1, 'd mmm yyyy, hh:mm:ss', '17:15:33'), 'PL-8890', 'Pallet Pl', 'Karan Singh', 'Check-In', 'Mumbai WH', 'Success'],
        [this.getRelativeDateStr(-1, 'd mmm yyyy, hh:mm:ss', '16:04:12'), 'TOOL-881', 'Calibration Tool', 'Vijay Nair', 'Check-Out', 'Manufacturing Line 2', 'Success']
      ];
    } else if (reportName === 'Movement History') {
      headers = ['Timestamp', 'Asset ID', 'RFID Tag EPC', 'From Zone', 'To Zone', 'Dwell Time', 'Reader Gate'];
      rows = [
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '10:21:40'), 'RM-COIL-402', 'E28011702000021A3F4B2C91', 'Staging A', 'Production Area', '45 Mins', 'Gate 4'],
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '09:55:12'), 'PL-8890', 'E28011702000021A3F4B2C92', 'Receiving Bay', 'Storage Row 12', '12 Mins', 'Gate 2'],
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '08:14:03'), 'TOOL-881', 'E28011702000021A3F4B2C93', 'Tool Room', 'Lab 1', '3 Hrs 12 Mins', 'Lab Reader'],
        [this.getRelativeDateStr(-1, 'd mmm yyyy, hh:mm:ss', '16:48:32'), 'FL-0098', 'E28011702000021A3F4B2C94', 'Zone A', 'Maintenance Area', '18 Mins', 'Maint Door'],
        [this.getRelativeDateStr(-1, 'd mmm yyyy, hh:mm:ss', '15:30:11'), 'TR-102', 'E28011702000021A3F4B2C95', 'Outbound Gate', 'Highway 4', '5 Mins', 'Main Exit']
      ];
    } else if (reportName === 'Zone Occupancy') {
      headers = ['Site', 'Zone Name', 'Current Occupancy', 'Design Capacity', 'Utilization Rate (%)', 'Alert Status'];
      rows = [
        ['Pune DC', 'Inbound Staging', '84', '100', '84.0%', 'Normal'],
        ['Pune DC', 'Aisle 4 (High Bay)', '412', '500', '82.4%', 'Normal'],
        ['Mumbai WH', 'Loading Dock 2', '18', '20', '90.0%', 'Warning - High'],
        ['Chennai Plant', 'Storage Room B', '98', '100', '98.0%', 'Critical - Overload'],
        ['Bengaluru Hub', 'Cross Dock', '32', '80', '40.0%', 'Normal'],
        ['Delhi NCR', 'Main Yard', '110', '150', '73.3%', 'Normal']
      ];
    } else if (reportName === 'GPS Route Summary') {
      headers = ['Vehicle', 'SIM IMEI', 'Start Point', 'End Point', 'Distance (km)', 'Travel Time', 'Status'];
      rows = [
        ['Truck-0098', '864201047712345', 'Mumbai DC', 'Pune WH', '145.2', '3 Hrs 15 Mins', 'Completed'],
        ['Truck-0102', '864201047712346', 'Delhi NCR Hub', 'Jaipur DC', '260.8', '5 Hrs 10 Mins', 'En Route'],
        ['Forklift-01', '864201047712347', 'Yard A', 'Dock 4', '12.4', '6 Hrs Active', 'Within Geofence'],
        ['Transit-02', '864201047712348', 'Chennai Plant', 'Bengaluru Hub', '345.5', '7 Hrs 45 Mins', 'Completed'],
        ['Truck-0110', '864201047712349', 'Hyderabad DC', 'Vijayawada DC', '275.0', '5 Hrs 30 Mins', 'Completed']
      ];
    } else if (reportName === 'Lost / Missing Asset Report') {
      headers = ['Asset ID', 'Category', 'Site', 'Last Scanned Zone', 'Last Seen Timestamp', 'RFID Tag EPC', 'Flagged By'];
      rows = [
        ['TOOL-401', 'Calibration Tool', 'Pune DC', 'Lab 2', this.getRelativeDateStr(-2, 'd mmm yyyy, hh:mm:ss', '14:12:00'), 'E28011702000021A3F4B2CA1', 'Admin'],
        ['PL-0023', 'Pallet Pl', 'Mumbai WH', 'Zone C', this.getRelativeDateStr(-5, 'd mmm yyyy, hh:mm:ss', '08:31:02'), 'E28011702000021A3F4B2CA2', 'System'],
        ['FL-0097', 'Forklift', 'Bengaluru Hub', 'Main Yard', this.getRelativeDateStr(-10, 'd mmm yyyy, hh:mm:ss', '11:42:15'), 'E28011702000021A3F4B2CA3', 'Supervisor'],
        ['RM-COIL-102', 'Raw Material', 'Delhi NCR', 'Buffer B', this.getRelativeDateStr(-8, 'd mmm yyyy, hh:mm:ss', '17:33:01'), 'E28011702000021A3F4B2CA4', 'System'],
        ['RFID-GATE-3', 'Handheld Reader', 'Hyderabad DC', 'Front Desk', this.getRelativeDateStr(-15, 'd mmm yyyy, hh:mm:ss', '09:12:30'), 'E28011702000021A3F4B2CA5', 'S. Kumar']
      ];
    } else if (reportName === 'Reader Performance') {
      headers = ['Reader Name', 'Location', 'Total Scans (Today)', 'Success Rate (%)', 'Uptime (%)', 'Connection Status', 'Last Activity'];
      rows = [
        ['Gate Reader 1', 'Pune DC Main Exit', '14,258', '99.8%', '100.0%', 'Online', this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '10:24:02')],
        ['Forklift Reader 2', 'Pune DC FL-0098', '3,452', '98.5%', '99.2%', 'Online', this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '10:23:45')],
        ['Dock Reader A', 'Mumbai WH Dock 4', '8,901', '99.2%', '100.0%', 'Online', this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '10:23:12')],
        ['Staging Reader', 'Chennai Plant Zone A', '5,671', '99.4%', '98.1%', 'Online', this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '10:21:00')],
        ['Yard Reader 1', 'Bengaluru Hub Yard', '12,982', '97.2%', '99.5%', 'Online', this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '10:24:00')],
        ['Exit Reader 2', 'Delhi NCR Gate 2', '7,890', '99.7%', '85.4%', 'Warning - High Noise', this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '10:23:59')]
      ];
    } else if (reportName === 'Tag Read Accuracy') {
      headers = ['Asset Category', 'Total Read Attempts', 'Missed Read Count', 'Accuracy Rate (%)', 'Uptime (%)', 'RSSI Average (dB)'];
      rows = [
        ['Raw Material', '142,500', '120', '99.92%', '100%', '-56 dB'],
        ['IT Assets', '24,800', '80', '99.68%', '100%', '-68 dB'],
        ['Forklifts', '34,500', '210', '99.39%', '99%', '-62 dB'],
        ['Calibration Tools', '12,400', '5', '99.96%', '100%', '-50 dB'],
        ['Pallets', '84,900', '430', '99.49%', '98%', '-70 dB'],
        ['Distribution Trucks', '42,000', '290', '99.31%', '99%', '-65 dB']
      ];
    } else if (reportName === 'Maintenance Cost') {
      headers = ['Category', 'Scheduled PM Cost ($)', 'Emergency Fixes ($)', 'Spare Parts ($)', 'Total Cost ($)', 'Variance vs Budget'];
      rows = [
        ['Forklifts', '4,250', '2,100', '1,850', '8,200', '+12.5%'],
        ['Trailer Trucks', '8,900', '4,500', '3,200', '16,600', '+8.4%'],
        ['Gantry Cranes', '12,000', '0', '1,500', '13,500', '-5.0%'],
        ['Calibration Tools', '1,200', '300', '100', '1,600', '0.0%'],
        ['RFID Readers', '800', '400', '300', '1,500', '+25.0%'],
        ['Others', '500', '200', '100', '800', '-10.0%']
      ];
    } else { // User Activity
      headers = ['Timestamp', 'Username', 'Role', 'Action Executed', 'IP Address', 'Result Status'];
      rows = [
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '10:24:02'), 'rohit.k', 'Operations Manager', 'Export Reports PDF', '192.168.1.45', 'Success'],
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '10:18:15'), 'rohit.k', 'Operations Manager', 'Apply Report Filter: Pune DC', '192.168.1.45', 'Success'],
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '09:44:30'), 'karan.s', 'Supervisor', 'Bulk Upload Asset list', '192.168.1.92', 'Success - 124 Items'],
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '09:12:11'), 'system_cron', 'Background Service', 'Trigger Auto Backup', '127.0.0.1', 'Success'],
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '08:30:00'), 'amit.s', 'Administrator', 'Change Reader Configuration: Gate 1', '192.168.1.12', 'Success'],
        [this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm:ss', '08:02:15'), 'rohit.k', 'Operations Manager', 'User Authentication Login', '192.168.1.45', 'Success']
      ];
    }

    if (format === 'pdf') {
      const pdf = new jsPDF('p', 'pt', 'a4');
      
      pdf.setFillColor(15, 23, 42);
      pdf.rect(0, 0, 595, 80, 'F');
      
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(18);
      pdf.text('TrackIt - Enterprise Asset Tracking System', 30, 35);
      
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(11);
      pdf.text(`Detailed Report: ${reportName} - India Operations`, 30, 58);
      
      pdf.setTextColor(100, 116, 139);
      pdf.setFontSize(9);
      pdf.text(`Report Generated On: ${this.getRelativeDateStr(0, 'd mmm yyyy, hh:mm AM/PM', '10:24 AM')}  |  Operator: Rohit Kumar (Operations Manager)`, 30, 110);
      
      pdf.setDrawColor(226, 232, 240);
      pdf.setLineWidth(1);
      pdf.line(30, 120, 565, 120);
      
      pdf.setFillColor(241, 245, 249);
      pdf.rect(30, 140, 535, 25, 'F');
      
      pdf.setTextColor(30, 41, 59);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      
      const colCount = headers.length;
      const colWidth = 535 / colCount;
      
      headers.forEach((h, i) => {
        pdf.text(h, 35 + (i * colWidth), 156);
      });
      
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.setTextColor(51, 65, 85);
      
      rows.forEach((row, rowIdx) => {
        const yPos = 182 + (rowIdx * 22);
        if (rowIdx % 2 === 1) {
          pdf.setFillColor(248, 250, 252);
          pdf.rect(30, yPos - 13, 535, 22, 'F');
        }
        pdf.line(30, yPos + 9, 565, yPos + 9);
        row.forEach((cell, cellIdx) => {
          pdf.text(cell.toString(), 35 + (cellIdx * colWidth), yPos);
        });
      });
      
      pdf.setFontSize(8);
      pdf.setTextColor(148, 163, 184);
      pdf.text('Confidential - TrackIt Operations | Generated via web portal export module.', 30, 780);
      pdf.text('Page 1 of 1', 530, 780);
      
      pdf.save(`${reportName.replace(/\s+/g, '_')}_Report.pdf`);
    } else {
      const sheetData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Report Data');
      
      const wscols = headers.map(() => ({ wch: 22 }));
      ws['!cols'] = wscols;
      
      XLSX.writeFile(wb, `${reportName.replace(/\s+/g, '_')}_Report.xlsx`);
    }
  }

  private startGpsAutoRefreshInterval() {
    if (isPlatformBrowser(this.platformId)) {
      this.gpsTimerInterval = setInterval(() => {
        if (!this.gpsAutoRefresh() || this.activeNav() !== 'GPS Tracking') return;
        this.fetchLiveGpsLocations();
      }, this.gpsRefreshInterval() * 1000);
    }
  }

  protected fetchLiveGpsLocations() {
    if (!this.isLoggedIn()) return;
    this.apiService.getVehicles().subscribe({
      next: (res: any) => {
        let list: any[] = [];
        if (Array.isArray(res)) {
          list = res;
        } else if (res && Array.isArray(res.value)) {
          list = res.value;
        }

        if (list.length >= 0) {
          const filteredMapped = list
            .map((v: any) => {
              const linkedAsset = this.assets().find(a => a.gpsId === v.deviceNum);

              let assetType: 'Vehicle' | 'Forklift' | 'Pallet/Bin' | 'Container' | 'Tool/Equipment' | 'Mobile Equipment' = 'Vehicle';
              const cat = (linkedAsset?.category || v.regName || '').toLowerCase();
              if (cat.includes('forklift')) {
                assetType = 'Forklift';
              } else if (cat.includes('pallet') || cat.includes('bin') || cat.includes('returnable')) {
                assetType = 'Pallet/Bin';
              } else if (cat.includes('container')) {
                assetType = 'Container';
              } else if (cat.includes('tool') || cat.includes('equip') || cat.includes('maint')) {
                assetType = 'Tool/Equipment';
              } else if (cat.includes('mobile')) {
                assetType = 'Mobile Equipment';
              }

              const lat = parseFloat(v.lat !== undefined ? v.lat : (v.Lat !== undefined ? v.Lat : '18.5204'));
              const lon = parseFloat(v.lon !== undefined ? v.lon : (v.Lon !== undefined ? v.Lon : '73.8567'));

              const x = Math.min(100, Math.max(0, Math.round(((lon - 73.8540) / (73.8600 - 73.8540)) * 100)));
              const y = Math.min(100, Math.max(0, Math.round(((18.6230 - lat) / (18.6230 - 18.6180)) * 100)));

              const speed = parseFloat(v.speed !== undefined ? v.speed : (v.Speed !== undefined ? v.Speed : '0')) || 0;
              const currentZone = speed > 0 ? 'Transit Route' : 'Main Yard';
              
              let lastRfidRead = '—';
              if (linkedAsset && linkedAsset.rfidTag) {
                const matchingEvents = this.scanEventsList().filter(evt => evt.epc === linkedAsset.rfidTag);
                if (matchingEvents.length > 0) {
                  lastRfidRead = matchingEvents[0].time;
                }
              }

              const battery = parseFloat(v.battery !== undefined ? v.battery : (v.Battery !== undefined ? v.Battery : '100')) || 100;
              const exception = battery < 25 ? 'Low Battery' : '';
              const gpsTimeRaw = v.gpsTime || v.GpsTime || v.updateTime || v.UpdateTime;
              const gpsTimeStr = gpsTimeRaw ? new Date(gpsTimeRaw).toLocaleTimeString() : new Date().toLocaleTimeString();

              const assetName = linkedAsset?.name || v.regName || ('GPS Asset ' + v.deviceNum);
              const assetTag = 'Asset: ' + (linkedAsset?.assetNumber || linkedAsset?.id || ('AST-' + (v.deviceNum.length > 4 ? v.deviceNum.substring(v.deviceNum.length - 4) : v.deviceNum)));

              return {
                id: v.deviceNum,
                name: assetName,
                tag: assetTag,
                type: assetType,
                status: v.status || 'Online',
                battery: Math.round(battery),
                speed: speed,
                latitude: lat,
                longitude: lon,
                currentZone: currentZone,
                lastGpsPing: gpsTimeStr,
                lastRfidRead: lastRfidRead,
                exception: exception,
                site: linkedAsset?.site || 'Pune DC',
                operator: linkedAsset?.currentCustodian || linkedAsset?.custodian || 'Unassigned',
                make: linkedAsset?.manufacturer || v.make || '',
                model: linkedAsset?.model || v.model || '',
                x,
                y,
                trail: [],
                timeline: [
                  {
                    time: gpsTimeStr,
                    zone: currentZone,
                    details: `Live telemetry from vehicle: Speed ${speed}km/h, Direction ${v.direction || 0}°`,
                    type: speed > 0 ? 'moving' as const : 'idle' as const
                  }
                ]
              };
            })
            .filter((item): item is NonNullable<typeof item> => item !== null);

          this.gpsAssets.set(filteredMapped);

          if (this.gpsAssets().length > 0 && !this.gpsSelectedAsset()) {
            this.selectGpsAsset(this.gpsAssets()[0]);
          } else if (this.gpsSelectedAsset()) {
            const updatedSelected = this.gpsAssets().find(a => a.id === this.gpsSelectedAsset()?.id);
            if (updatedSelected) {
              this.gpsSelectedAsset.set(updatedSelected);
              this.fetchGpsAssetHistory(updatedSelected.id);
              this.fetchSelectedLiveGpsLocation(updatedSelected.id);
            }
          }

          const assets = this.gpsAssets();
          this.gpsTotalAssets.set(assets.length);
          this.gpsMovingCount.set(assets.filter(a => a.speed > 0).length);
          this.gpsIdleCount.set(assets.filter(a => a.speed === 0).length);
          this.gpsStoppedCount.set(assets.filter(a => a.status.includes('ACC OFF') || a.speed === 0).length);
          this.gpsLowBatteryCount.set(assets.filter(a => a.battery < 25).length);
          this.gpsExceptionCount.set(assets.filter(a => a.exception !== '').length);
          this.gpsOfflineCount.set(assets.filter(a => a.status.includes('Offline')).length);
          if (this.gpsMapMode() === 'satellite') {
            this.updateSatelliteMarkers();
          }
        }
      },
      error: (err) => console.error('Failed to load GPS vehicles from PostgreSQL', err)
    });
  }

  protected fetchGpsAssetHistory(imei: string) {
    const dateStr = this.gpsSelectedDate();
    const begin = new Date(dateStr + 'T00:00:00');
    const end = new Date(dateStr + 'T23:59:59');
    
    this.apiService.getGPSHistory(imei, begin.toISOString(), end.toISOString()).subscribe({
      next: (res) => {
        let list: any[] = [];
        if (res) {
          if (Array.isArray(res)) {
            list = res;
          } else if (res.detail) {
            list = Array.isArray(res.detail) ? res.detail : (res.detail.data || res.detail.list || []);
          } else if (res.data) {
            list = Array.isArray(res.data) ? res.data : [];
          }
        }
        this.gpsAssetHistory.set(list);
        if (this.gpsMapMode() === 'satellite') {
          this.updateSatelliteMarkers();
        }
      },
      error: (err) => {
        console.error('Failed to load GPS history for ' + imei, err);
        this.gpsAssetHistory.set([]);
      }
    });
  }

  protected onGpsDateChange(newDate: string) {
    if (!newDate) return;
    this.gpsSelectedDate.set(newDate);
    const selected = this.gpsSelectedAsset();
    if (selected) {
      this.fetchGpsAssetHistory(selected.id);
    }
  }

  protected fetchSelectedLiveGpsLocation(vehicleId: string) {
    this.apiService.getGPSLocation(vehicleId).subscribe({
      next: (res: any) => {
        if (res && res.detail && res.detail.data && res.detail.data.length > 0) {
          const v = res.detail.data[0];
          const lat = parseFloat(v.Lat || '0');
          const lon = parseFloat(v.Lon || '0');
          const speed = parseFloat(v.Speed || '0');
          const direction = v.Direction || '0';
          const battery = parseFloat(v.Battery || '100');
          const status = v.OnlineStatusStr || v.OnlineStatus || 'Active';
          const gpsTime = v.GpsTime ? new Date(v.GpsTime).toLocaleTimeString() : new Date().toLocaleTimeString();

          const x = Math.min(100, Math.max(0, Math.round(((lon - 73.8540) / (73.8600 - 73.8540)) * 100)));
          const y = Math.min(100, Math.max(0, Math.round(((18.6230 - lat) / (18.6230 - 18.6180)) * 100)));

          const currentSel = this.gpsSelectedAsset();
          if (currentSel && currentSel.id === vehicleId) {
            const updated = {
              ...currentSel,
              latitude: lat,
              longitude: lon,
              speed: speed,
              direction: direction,
              battery: isNaN(battery) ? 100 : Math.round(battery),
              status: status,
              lastGpsPing: gpsTime,
              x: x,
              y: y
            };
            this.gpsSelectedAsset.set(updated);
            this.gpsAssets.update(list => list.map(a => a.id === vehicleId ? updated : a));
            if (this.gpsMapMode() === 'satellite') {
              this.updateSatelliteMarkers();
            }
          }
        }
      },
      error: (err) => console.error('Failed to fetch live location for ' + vehicleId, err)
    });
  }

  protected toggleMapMode() {
    const newMode = this.gpsMapMode() === 'blueprint' ? 'satellite' : 'blueprint';
    this.gpsMapMode.set(newMode);
    if (newMode === 'satellite') {
      // Wait longer so Angular @if block renders the DOM before Leaflet initializes
      setTimeout(() => this.initSatelliteMap(), 400);
    } else {
      this.destroySatelliteMap();
    }
  }

  protected switchMapLayer(layer: 'satellite' | 'hybrid' | 'street') {
    this.gpsMapLayer.set(layer);
    if (this.satelliteMap && typeof window !== 'undefined' && (window as any).L) {
      const L = (window as any).L;
      if (this.satelliteTileLayer) {
        this.satelliteTileLayer.remove();
      }
      this.satelliteTileLayer = this.createTileLayer(L, layer);
      this.satelliteTileLayer.addTo(this.satelliteMap);
    }
  }

  private getTileLayerConfig(layer: 'satellite' | 'hybrid' | 'street'): { url: string; attribution: string; maxZoom: number; subdomains?: string } {
    if (layer === 'satellite' || layer === 'hybrid') {
      return {
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
        maxZoom: 19
      };
    } else {
      return {
        url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
      };
    }
  }

  private createTileLayer(L: any, layer: 'satellite' | 'hybrid' | 'street'): any {
    const config = this.getTileLayerConfig(layer);
    const tileLayer = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom,
      subdomains: config.subdomains || 'abc'
    });
    tileLayer.on('tileerror', (err: any) => {
      console.warn('Tile load error:', err.tile?.src);
    });
    if (layer === 'hybrid') {
      const roadOverlay = L.tileLayer(
        'https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png',
        { opacity: 0.85, maxZoom: 19, subdomains: 'abcd' }
      );
      const group = L.layerGroup([tileLayer, roadOverlay]);
      return group;
    }
    return tileLayer;
  }

  protected centerMapOnSite(site: string) {
    if (!this.satelliteMap) return;
    const siteCoords: Record<string, { lat: number; lon: number; zoom: number }> = {
      'Pune DC': { lat: 18.6203, lon: 73.8567, zoom: 16 },
      'Mumbai Warehouse': { lat: 19.2183, lon: 73.0862, zoom: 16 },
      'Chennai Plant': { lat: 13.0827, lon: 80.2707, zoom: 16 },
      'Bengaluru Hub': { lat: 12.9716, lon: 77.5946, zoom: 16 },
      'All Sites': { lat: 20.5937, lon: 78.9629, zoom: 5 }
    };
    const config = siteCoords[site] || siteCoords['Pune DC'];
    this.satelliteMap.setView([config.lat, config.lon], config.zoom, { animate: true, duration: 1.0 });
  }

  protected initSatelliteMap(retryCount = 0) {
    if (typeof window === 'undefined') return;
    
    // If Leaflet JS CDN script is not loaded yet, retry up to 20 times
    if (!(window as any).L) {
      if (retryCount < 20) {
        setTimeout(() => this.initSatelliteMap(retryCount + 1), 250);
      }
      return;
    }
    const L = (window as any).L;

    // Check if the map container DOM element exists yet (Angular @if may not have rendered it)
    const mapContainer = document.getElementById('leaflet-satellite-map');
    if (!mapContainer) {
      if (retryCount < 20) {
        setTimeout(() => this.initSatelliteMap(retryCount + 1), 200);
      }
      return;
    }

    if (this.satelliteMap) {
      this.destroySatelliteMap();
    }

    const site = this.selectedSite();
    const siteCoords: Record<string, { lat: number; lon: number; zoom: number }> = {
      'Pune DC': { lat: 18.6203, lon: 73.8567, zoom: 16 },
      'Mumbai Warehouse': { lat: 19.2183, lon: 73.0862, zoom: 16 },
      'Chennai Plant': { lat: 13.0827, lon: 80.2707, zoom: 16 },
      'Bengaluru Hub': { lat: 12.9716, lon: 77.5946, zoom: 16 },
      'All Sites': { lat: 20.5937, lon: 78.9629, zoom: 5 }
    };
    const siteConfig = siteCoords[site] || siteCoords['Pune DC'];

    let centerLat = siteConfig.lat;
    let centerLon = siteConfig.lon;
    let initialZoom = siteConfig.zoom;

    const selected = this.gpsSelectedAsset();
    const filteredAssets = this.filteredGpsAssets();
    const firstAsset = filteredAssets[0];

    if (selected && selected.latitude && selected.longitude) {
      centerLat = selected.latitude;
      centerLon = selected.longitude;
      initialZoom = 17;
    } else if (firstAsset && firstAsset.latitude && firstAsset.longitude) {
      centerLat = firstAsset.latitude;
      centerLon = firstAsset.longitude;
      initialZoom = 16;
    }

    this.satelliteMap = L.map('leaflet-satellite-map', {
      zoomControl: false,
      attributionControl: true
    }).setView([centerLat, centerLon], initialZoom);

    // Add the selected tile layer
    this.satelliteTileLayer = this.createTileLayer(L, this.gpsMapLayer());
    this.satelliteTileLayer.addTo(this.satelliteMap);

    // Add scale bar
    L.control.scale({ position: 'bottomleft', imperial: false }).addTo(this.satelliteMap);

    // Force Leaflet to recalculate container size immediately and after transitions
    this.satelliteMap.invalidateSize(false);
    [100, 300, 600, 1000].forEach(delay => {
      setTimeout(() => {
        if (this.satelliteMap) {
          this.satelliteMap.invalidateSize(true);
        }
      }, delay);
    });

    this.updateSatelliteMarkers();
  }

  private destroySatelliteMap() {
    if (this.satelliteMap) {
      try {
        this.satelliteMap.remove();
      } catch (e) {
        console.error('Error removing Leaflet map:', e);
      }
      this.satelliteMap = null;
    }
    this.satelliteMarkers.clear();
    this.satelliteAccuracyCircles.clear();
    this.satelliteTrailPolyline = null;
    this.satelliteTileLayer = null;
  }

  private updateSatelliteMarkers() {
    if (!this.satelliteMap || typeof window === 'undefined' || !(window as any).L) return;
    const L = (window as any).L;

    const assets = this.filteredGpsAssets();
    const selected = this.gpsSelectedAsset();
    const activeIds = new Set(assets.map(a => a.id));

    // Remove stale markers
    for (const [id, marker] of this.satelliteMarkers.entries()) {
      if (!activeIds.has(id)) {
        marker.remove();
        this.satelliteMarkers.delete(id);
      }
    }
    for (const [id, circle] of this.satelliteAccuracyCircles.entries()) {
      if (!activeIds.has(id)) {
        circle.remove();
        this.satelliteAccuracyCircles.delete(id);
      }
    }

    for (const asset of assets) {
      if (!asset.latitude || !asset.longitude) continue;

      const isSelected = selected?.id === asset.id;
      const isMoving = asset.speed > 0;
      const isOffline = asset.status.toLowerCase().includes('offline');
      const color = isSelected ? '#3b82f6' : (isMoving ? '#10b981' : (isOffline ? '#64748b' : '#f59e0b'));
      const iconName = asset.type === 'Vehicle' ? 'local_shipping' : (asset.type === 'Forklift' ? 'precision_manufacturing' : 'inventory_2');

      const iconHtml = `
        <div style="position: relative; display: flex; flex-direction: column; align-items: center;">
          ${isSelected ? `
            <div style="position: absolute; width: 42px; height: 42px; border-radius: 50%; border: 2.5px solid #3b82f6; animation: pulse-ring 1.5s infinite; transform: translate(-9px, -9px); pointer-events:none;"></div>
            <div style="position: absolute; width: 28px; height: 28px; border-radius: 50%; background: rgba(59,130,246,0.18); transform: translate(-2px, -2px); pointer-events:none;"></div>
          ` : ''}
          <div style="background: ${color}; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; box-shadow: 0 3px 8px rgba(0,0,0,0.4); border: 2.5px solid white; z-index: 10; transition: background 0.3s;">
            <span class="material-symbols-outlined" style="font-size: 13px; font-variation-settings: 'FILL' 1;">${iconName}</span>
          </div>
          <div style="background: rgba(10,14,28,0.9); color: white; font-family: 'Plus Jakarta Sans', sans-serif; font-size: 9.5px; font-weight: 700; padding: 2px 7px; border-radius: 4px; white-space: nowrap; margin-top: 3px; box-shadow: 0 2px 6px rgba(0,0,0,0.35); border: 1px solid rgba(255,255,255,0.12); letter-spacing: 0.01em;">
            ${asset.name}${isMoving ? ' <span style="color:#10b981;">▶</span>' : ''}
          </div>
          ${isSelected ? `<div style="font-size:8.5px; color: rgba(255,255,255,0.75); background: rgba(10,14,28,0.75); padding: 1px 5px; border-radius: 3px; margin-top: 2px; white-space:nowrap; font-family:monospace;">${asset.latitude.toFixed(5)}, ${asset.longitude.toFixed(5)}</div>` : ''}
        </div>
      `;

      const customIcon = L.divIcon({
        html: iconHtml,
        className: 'custom-leaflet-marker',
        iconSize: [24, isSelected ? 60 : 44],
        iconAnchor: [12, 12]
      });

      // Accuracy circle for selected asset (GPS accuracy ~10-50m)
      if (isSelected) {
        let circle = this.satelliteAccuracyCircles.get(asset.id);
        if (circle) {
          circle.setLatLng([asset.latitude, asset.longitude]);
        } else {
          circle = L.circle([asset.latitude, asset.longitude], {
            radius: 30,
            color: '#3b82f6',
            fillColor: '#3b82f6',
            fillOpacity: 0.08,
            weight: 1.5,
            dashArray: '4,4',
            interactive: false
          }).addTo(this.satelliteMap);
          this.satelliteAccuracyCircles.set(asset.id, circle);
        }
      } else {
        const oldCircle = this.satelliteAccuracyCircles.get(asset.id);
        if (oldCircle) {
          oldCircle.remove();
          this.satelliteAccuracyCircles.delete(asset.id);
        }
      }

      let marker = this.satelliteMarkers.get(asset.id);
      if (marker) {
        marker.setLatLng([asset.latitude, asset.longitude]);
        marker.setIcon(customIcon);
      } else {
        marker = L.marker([asset.latitude, asset.longitude], { icon: customIcon, zIndexOffset: isSelected ? 1000 : 0 })
          .addTo(this.satelliteMap)
          .on('click', () => {
            this.zone.run(() => {
              this.selectGpsAsset(asset);
            });
          });
        this.satelliteMarkers.set(asset.id, marker);
      }
    }

    // Auto-track: pan & zoom to selected asset if auto-track is on
    if (selected && selected.latitude && selected.longitude && this.gpsAutoTrack()) {
      const currentCenter = this.satelliteMap.getCenter();
      const currentZoom = this.satelliteMap.getZoom();
      const targetZoom = Math.max(currentZoom, 17);
      const latDiff = Math.abs(currentCenter.lat - selected.latitude);
      const lonDiff = Math.abs(currentCenter.lng - selected.longitude);

      if (latDiff > 0.00005 || lonDiff > 0.00005 || currentZoom !== targetZoom) {
        this.satelliteMap.setView([selected.latitude, selected.longitude], targetZoom, { animate: true, duration: 0.5 });
      }
    }

    // Draw route trail polyline
    if (this.satelliteTrailPolyline) {
      this.satelliteTrailPolyline.remove();
      this.satelliteTrailPolyline = null;
    }

    const trailPoints = (this.isGpsPlaybackActive() && this.gpsPlaybackTrail.length > 0) 
      ? this.gpsPlaybackTrail 
      : this.gpsAssetHistory();

    if (trailPoints && trailPoints.length > 0) {
      const latLngs = trailPoints
        .map((pt: any) => {
          const latRaw = pt.lat !== undefined ? pt.lat : (pt.Lat !== undefined ? pt.Lat : (pt.latitude !== undefined ? pt.latitude : pt.Latitude));
          const lonRaw = pt.lon !== undefined ? pt.lon : (pt.Lon !== undefined ? pt.Lon : (pt.longitude !== undefined ? pt.longitude : pt.Longitude));
          const lat = parseFloat(latRaw);
          const lon = parseFloat(lonRaw);
          return (latRaw !== undefined && lonRaw !== undefined && !isNaN(lat) && !isNaN(lon)) ? [lat, lon] : null;
        })
        .filter((pt: any): pt is [number, number] => pt !== null);

      if (latLngs.length > 0) {
        // Draw bright glowing route trail with thick visible polyline
        this.satelliteTrailPolyline = L.polyline(latLngs, {
          color: '#3b82f6',
          weight: 6,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(this.satelliteMap);

        // Start marker pin (first point)
        if (latLngs.length > 1) {
          const startIcon = L.divIcon({
            html: `<div style="width:14px;height:14px;border-radius:50%;background:#10b981;border:2.5px solid white;box-shadow:0 0 8px rgba(16,185,129,0.8);"></div>`,
            className: '',
            iconSize: [14, 14],
            iconAnchor: [7, 7]
          });
          L.marker(latLngs[0], { icon: startIcon, interactive: false }).addTo(this.satelliteMap);
        }

        // Fit map bounds to encompass the full GPS route
        if (latLngs.length > 1 && this.isGpsPlaybackActive()) {
          try {
            this.satelliteMap.fitBounds(this.satelliteTrailPolyline.getBounds(), { padding: [40, 40], maxZoom: 17 });
          } catch (e) {
            console.warn('fitBounds warning:', e);
          }
        }
      }
    }
  }

  protected centerOnSelectedAsset() {
    if (!this.satelliteMap || !this.gpsSelectedAsset()) return;
    const asset = this.gpsSelectedAsset()!;
    if (asset.latitude && asset.longitude) {
      this.satelliteMap.setView([asset.latitude, asset.longitude], 18, { animate: true, duration: 0.8 });
    }
  }

  protected selectGpsAsset(asset: GPSAsset) {
    this.gpsSelectedAsset.set(asset);
    this.gpsDetailTab.set('overview');
    this.fetchGpsAssetHistory(asset.id);
    this.fetchSelectedLiveGpsLocation(asset.id);
    if (this.satelliteMap && asset.latitude && asset.longitude) {
      const currentZoom = this.satelliteMap.getZoom();
      const targetZoom = Math.max(currentZoom, 18);
      this.satelliteMap.setView([asset.latitude, asset.longitude], targetZoom, { animate: true, duration: 0.8 });
    }
    if (this.gpsMapMode() === 'satellite') {
      setTimeout(() => this.updateSatelliteMarkers(), 100);
    }
  }

  protected triggerGpsRefresh() {
    this.fetchLiveGpsLocations();
  }

  protected fetchAlerts() {
    if (!this.isLoggedIn()) return;
    this.apiService.getAlerts().subscribe({
      next: (res) => {
        const list = res.body || res;
        if (Array.isArray(list)) {
          this.maintAlerts.set(list.map(a => ({
            id: a.id,
            severity: a.severity || 'Medium',
            assetId: a.assetName || ('Asset ' + a.assetId),
            assetType: 'Equipment',
            alertType: a.alertType || a.title || 'System Alert',
            currentSite: a.resolvedByUsername || 'Pune DC',
            assignedTechnician: 'Technical Support',
            sla: '24 Hours',
            status: a.isResolved ? 'Resolved' : 'Open',
            raisedTime: a.resolvedDate ? new Date(a.resolvedDate).toLocaleDateString() : 'Just now',
            description: a.message || '',
            spares: [],
            estimatedCost: 0,
            gstInvoice: '',
            estimatedDowntime: 'Under 1 Hour',
            notes: ''
          })));

          const notifs = list.map(a => {
            const dt = a.timestamp || a.createdOn ? new Date(a.timestamp || a.createdOn) : new Date();
            const timeStr = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            return {
              id: a.id,
              text: a.message || a.title || `${a.severity || 'System'} alert triggered`,
              time: timeStr,
              read: a.isResolved || false,
              type: (a.severity?.toLowerCase() === 'high' || a.severity?.toLowerCase() === 'critical') ? 'danger' : ((a.severity?.toLowerCase() === 'medium' || a.severity?.toLowerCase() === 'warning') ? 'warning' : 'info')
            };
          });
          this.notifications.set(notifs);
        }
      },
      error: (err) => console.error('Failed to load alerts from database', err)
    });
  }

  protected saveMaintenanceAlert(selected: any, nextStatus?: string) {
    if (!selected) return;
    
    if (nextStatus) {
      selected.status = nextStatus;
    }

    const isResolved = selected.status === 'Resolved';

    const payload = {
      id: selected.id,
      assetId: null,
      alertType: selected.alertType || 'Maintenance',
      severity: selected.severity || 'Medium',
      title: selected.alertType || 'Maintenance Alert',
      message: selected.description || 'Maintenance requested',
      isResolved: isResolved,
      resolvedDate: isResolved ? new Date().toISOString() : null,
      resolvedByUsername: selected.currentSite || 'Pune DC'
    };

    this.apiService.updateAlert(selected.id, payload).subscribe({
      next: () => {
        alert('Work Order status updated in database successfully!');
        this.fetchAlerts();
        this.maintSelectedAlert.set(null);
      },
      error: (err) => {
        console.error('Failed to update alert in database', err);
        alert('Failed to update alert');
      }
    });
  }

  protected selectInventoryItem(item: InventoryItem) {
    this.inventorySelectedItem.set(item);
  }

  protected runInventoryReconciliation() {
    if (this.isReconciling()) return;
    this.isReconciling.set(true);
    this.reconciliationProgress.set(10);
    
    const interval = setInterval(() => {
      const current = this.reconciliationProgress();
      if (current >= 100) {
        clearInterval(interval);
        this.isReconciling.set(false);
        this.inventoryItems.update(items => {
          return items.map(item => {
            if (item.status === 'Discrepancy' && Math.random() > 0.4) {
              return {
                ...item,
                actualQty: item.expectedQty,
                status: 'In Stock',
                lastAuditTime: new Date().toLocaleString('en-US', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                checkedBy: 'Prosper Admin (RFID Reconciled)'
              };
            }
            return item;
          });
        });
      } else {
        this.reconciliationProgress.set(current + 20);
      }
    }, 300);
  }

  protected toggleIntegration(id: string) {
    this.integrations.update(list => list.map(item => {
      if (item.id === id) {
        const nextStatus = item.status === 'Connected' ? 'Disconnected' : 'Connected';
        return {
          ...item,
          status: nextStatus,
          lastSync: nextStatus === 'Connected' ? 'Just now' : item.lastSync
        };
      }
      return item;
    }));
  }

  protected toggleUserStatus(id: string) {
    const user = this.adminUsers().find(u => u.id === id);
    if (!user) return;
    const nextActive = user.status !== 'Active';
    const roleId = user.role.includes('Admin') ? 'e1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c61' : 'e1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c62';
    const payload = {
      username: user.username,
      email: user.email,
      isActive: nextActive,
      roleIds: [roleId]
    };
    this.apiService.updateUser(id, payload).subscribe({
      next: () => this.loadAllApiData(),
      error: (err) => console.error('Error toggling user status', err)
    });
  }

  protected toggleReaderStatus(id: string) {
    const reader = this.adminReaders().find(r => r.id === id);
    if (!reader) return;
    const nextStatus = reader.status === 'Online' ? 'Offline' : 'Online';
    const payload = {
      name: reader.location,
      ipAddress: reader.ipAddress,
      port: reader.port || 5084,
      antennaCount: reader.antennas,
      powerDbm: reader.powerDbm,
      siteId: reader.siteId || 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c91',
      model: reader.model,
      status: nextStatus
    };
    this.apiService.updateReader(id, payload).subscribe({
      next: () => this.loadAllApiData(),
      error: (err) => console.error('Error toggling reader status', err)
    });
  }

  // User Administration Handlers
  protected openAddUserModal() {
    this.userModalMode.set('add');
    this.formUserId.set('');
    this.formUserUsername = '';
    this.formUserEmail = '';
    this.formUserPassword = '';
    this.formUserRole = 'Viewer';
    this.formUserSiteId = '';
    this.formUserWarehouseId = '';
    this.formUserSelectedSiteIds.set([]);
    this.formUserSelectedWarehouseIds.set([]);
    this.formUserIsActive = true;
    this.isUserModalOpen.set(true);
  }

  protected openEditUserModal(user: any) {
    this.userModalMode.set('edit');
    this.formUserId.set(user.id);
    this.formUserUsername = user.username;
    this.formUserEmail = user.email;
    this.formUserPassword = '';
    this.formUserSiteId = user.siteId || '';
    this.formUserWarehouseId = user.warehouseId || '';
    this.formUserSelectedSiteIds.set(user.selectedSiteIds || (user.siteId ? [user.siteId] : []));
    this.formUserSelectedWarehouseIds.set(user.selectedWarehouseIds || (user.warehouseId ? [user.warehouseId] : []));
    if (user.roles && user.roles.length > 0) {
      this.formUserRole = user.roles[0];
    } else {
      this.formUserRole = 'Viewer';
    }
    this.formUserIsActive = user.status === 'Active';
    this.isUserModalOpen.set(true);
  }

  protected saveUser() {
    let roleId = 'e5a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c62'; // default Viewer
    if (this.formUserRole === 'Super Admin' || this.formUserRole === 'Administrator') {
      roleId = 'e1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c62';
    } else if (this.formUserRole === 'Site Admin') {
      roleId = 'e2a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c62';
    } else if (this.formUserRole === 'Supervisor') {
      roleId = 'e3a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c62';
    } else if (this.formUserRole === 'Driver') {
      roleId = 'e4a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c62';
    }

    const payload: any = {
      username: this.formUserUsername,
      email: this.formUserEmail,
      roleIds: [roleId],
      siteId: this.formUserSiteId ? this.formUserSiteId : null
    };

    if (this.userModalMode() === 'add') {
      payload.password = this.formUserPassword || '123456';
      this.apiService.createUser(payload).subscribe({
        next: () => {
          this.loadAllApiData();
          this.isUserModalOpen.set(false);
        },
        error: (err) => console.error('Error creating user', err)
      });
    } else {
      payload.isActive = this.formUserIsActive;
      this.apiService.updateUser(this.formUserId(), payload).subscribe({
        next: () => {
          this.loadAllApiData();
          this.isUserModalOpen.set(false);
        },
        error: (err) => console.error('Error updating user', err)
      });
    }
  }

  protected deleteUser(id: string) {
    if (confirm('Are you sure you want to delete this user?')) {
      this.apiService.deleteUser(id).subscribe({
        next: () => this.loadAllApiData(),
        error: (err) => console.error('Error deleting user', err)
      });
    }
  }

  // Reader Administration Handlers
  protected openAddReaderModal() {
    this.readerModalMode.set('add');
    this.formReaderId.set('');
    this.formReaderName = '';
    this.formReaderModel = 'Zebra FX9600';
    this.formReaderIpAddress = '';
    this.formReaderPort = 5084;
    this.formReaderAntennaCount = 4;
    this.formReaderPowerDbm = 30;
    this.formReaderSiteId = 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c91';
    this.formReaderStatus = 'Online';
    this.isReaderModalOpen.set(true);
  }

  protected openEditReaderModal(reader: any) {
    this.readerModalMode.set('edit');
    this.formReaderId.set(reader.id);
    this.formReaderName = reader.location;
    this.formReaderModel = reader.model;
    this.formReaderIpAddress = reader.ipAddress;
    this.formReaderPort = reader.port || 5084;
    this.formReaderAntennaCount = reader.antennas || reader.antennaCount || 4;
    this.formReaderPowerDbm = reader.powerDbm;
    this.formReaderSiteId = reader.siteId || 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c91';
    this.formReaderStatus = reader.status;
    this.isReaderModalOpen.set(true);
  }

  protected saveReader() {
    if (!this.formReaderName || !this.formReaderIpAddress) {
      alert('Please fill out Reader Name and IP Address.');
      return;
    }
    const payload = {
      name: this.formReaderName,
      ipAddress: this.formReaderIpAddress,
      port: this.formReaderPort,
      antennaCount: this.formReaderAntennaCount,
      powerDbm: this.formReaderPowerDbm,
      siteId: this.formReaderSiteId,
      model: this.formReaderModel,
      status: this.formReaderStatus
    };

    if (this.readerModalMode() === 'add') {
      this.apiService.createReader(payload).subscribe({
        next: () => {
          alert('Reader registered successfully!');
          this.loadAllApiData();
          this.isReaderModalOpen.set(false);
        },
        error: (err) => {
          console.error('Error creating reader', err);
          alert('Failed to register reader: ' + (err.error?.message || err.message || 'Unknown error'));
        }
      });
    } else {
      this.apiService.updateReader(this.formReaderId(), payload).subscribe({
        next: () => {
          alert('Reader details updated successfully!');
          this.loadAllApiData();
          this.isReaderModalOpen.set(false);
        },
        error: (err) => {
          console.error('Error updating reader', err);
          alert('Failed to update reader: ' + (err.error?.message || err.message || 'Unknown error'));
        }
      });
    }
  }

  protected deleteReader(id: string) {
    if (confirm('Are you sure you want to delete this reader profile?')) {
      this.apiService.deleteReader(id).subscribe({
        next: () => {
          alert('Reader deleted successfully.');
          this.loadAllApiData();
        },
        error: (err) => {
          console.error('Error deleting reader', err);
          alert('Failed to delete reader: ' + (err.error?.message || err.message || 'Unknown error'));
        }
      });
    }
  }

  // Handheld Devices Registry Handlers
  protected openAddHandheldModal() {
    this.handheldModalMode.set('add');
    this.formHandheldId.set('');
    this.formHandheldName = '';
    this.formHandheldSerial = '';
    this.formHandheldModel = 'Zebra TC20 + RFD8500';
    this.formHandheldUserId = '';
    this.isHandheldModalOpen.set(true);
  }

  protected openEditHandheldModal(device: any) {
    this.handheldModalMode.set('edit');
    this.formHandheldId.set(device.id);
    this.formHandheldName = device.name;
    this.formHandheldSerial = device.deviceSerial;
    this.formHandheldModel = device.model || '';
    this.formHandheldUserId = device.assignedUserId || '';
    this.isHandheldModalOpen.set(true);
  }

  protected saveHandheld() {
    if (!this.formHandheldName || !this.formHandheldSerial) {
      alert('Please fill out Device Name and Device Serial Number.');
      return;
    }
    const payload = {
      name: this.formHandheldName,
      deviceSerial: this.formHandheldSerial,
      model: this.formHandheldModel,
      assignedUserId: this.formHandheldUserId ? this.formHandheldUserId : null
    };

    if (this.handheldModalMode() === 'add') {
      this.apiService.createHandheld(payload).subscribe({
        next: () => {
          alert('Handheld scanner registered successfully!');
          this.loadAllApiData();
          this.isHandheldModalOpen.set(false);
        },
        error: (err) => {
          console.error('Error creating handheld device', err);
          alert('Failed to register handheld device: ' + (err.error?.message || err.message || 'Unknown error'));
        }
      });
    } else {
      this.apiService.updateHandheld(this.formHandheldId(), payload).subscribe({
        next: () => {
          alert('Handheld scanner details updated successfully!');
          this.loadAllApiData();
          this.isHandheldModalOpen.set(false);
        },
        error: (err) => {
          console.error('Error updating handheld device', err);
          alert('Failed to update handheld device: ' + (err.error?.message || err.message || 'Unknown error'));
        }
      });
    }
  }

  protected deleteHandheld(id: string) {
    if (confirm('Are you sure you want to delete this handheld scanner?')) {
      this.apiService.deleteHandheld(id).subscribe({
        next: () => {
          alert('Handheld scanner deleted successfully.');
          this.loadAllApiData();
        },
        error: (err) => {
          console.error('Error deleting handheld device', err);
          alert('Failed to delete handheld device: ' + (err.error?.message || err.message || 'Unknown error'));
        }
      });
    }
  }

  protected deleteApiKey(name: string) {
    this.adminApiKeys.update(list => list.filter(k => k.name !== name));
  }

  protected generateApiKey() {
    if (!isPlatformBrowser(this.platformId)) return;
    const name = window.prompt('Enter API Key Name:');
    if (name) {
      const prefix = 'tr_live_' + Math.random().toString(36).substring(2, 6) + '...';
      this.adminApiKeys.update(list => [
        ...list,
        { name, keyPrefix: prefix, createdBy: 'Prosper Admin', createdAt: new Date().toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }), status: 'Active' }
      ]);
    }
  }

  // Check in/Check out & Issue-Return workflow methods
  protected simulateRfidScan() {
    const availableAssets = this.assets().filter(a => a.status === 'Available' || a.status === 'In Use' || a.status === 'Checked Out');
    if (availableAssets.length > 0) {
      const withTag = availableAssets.find(a => a.rfidTag && a.rfidTag.length > 5);
      const randomAsset = withTag || availableAssets[Math.floor(Math.random() * availableAssets.length)];
      this.checkoutRfidTag.set(randomAsset.rfidTag || 'AST-TRC-001245');
    } else {
      this.checkoutRfidTag.set('AST-TRC-001245');
    }
  }

  protected submitWorkflow() {
    const tag = this.checkoutRfidTag().trim();
    const details = this.checkoutAssetDetails();
    const mode = this.checkoutMode();
    const custodian = this.checkoutAssignee().trim();
    const assigneeType = this.checkoutAssigneeType();
    const purpose = this.checkoutPurpose().trim();
    
    if (!tag) {
      alert('Please scan or enter an RFID tag.');
      return;
    }
    
    if (!custodian) {
      alert('Please select or enter an assignee.');
      return;
    }

    let targetStatus: 'Available' | 'Assigned' | 'InTransit' | 'UnderMaintenance' | 'Retired' = 'Available';
    let localStatus: 'Available' | 'In Use' | 'Checked Out' | 'Under Maintenance' = 'Available';
    let modeText = 'Material Issue';
    let statusText = 'Approved';
    
    if (mode === 'issue') {
      targetStatus = 'Assigned';
      localStatus = 'In Use';
      modeText = 'Material Issue';
      statusText = 'Approved';
    } else if (mode === 'return') {
      targetStatus = 'Available';
      localStatus = 'Available';
      modeText = 'Material Return';
      statusText = 'Completed';
    } else if (mode === 'transfer') {
      targetStatus = 'InTransit';
      localStatus = 'Checked Out';
      modeText = 'Inter-Site Transfer';
      statusText = 'Completed';
    }

    if (details) {
      let catGuid = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
      if (details.category === 'Material Handling Equipment') catGuid = 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e';
      else if (details.category === 'IT Assets') catGuid = 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f';
      else if (details.category === 'Vehicles') catGuid = 'd4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a';
      else if (details.category === 'Power Equipment') catGuid = 'e5f6a7b8-c9d0-1e2f-3a4b-5c6d7e8f9a0b';
      else if (details.category === 'Material Handling') catGuid = 'f6a7b8c9-d0e1-2f3a-4b5c-6d7e8f9a0b1c';
      else if (details.category === 'Consumables') catGuid = 'a7b8c9d0-e1f2-3a4b-5c6d-7e8f9a0b1c2d';

      if (details.id && !details.id.startsWith('AST-MOCK')) {
        const payload = {
          id: details.id,
          assetNumber: details.assetNumber || details.id,
          name: details.name,
          description: details.gpsId || 'GPS-DEVICE',
          serialNumber: details.rfidTag,
          status: targetStatus,
          assetCategoryId: catGuid
        };
        this.http.put(`${environment.apiUrl}/assets/${details.id}`, payload).subscribe({
          next: () => { 
            this.fetchAssets(); 
            if (mode === 'issue') {
              const user = this.authService.currentUser();
              const userId = user ? user.id : 'e1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c6d';
              const assignmentPayload = {
                assetId: details.id,
                assignedToUserId: userId,
                custodianName: custodian,
                assignedDate: new Date().toISOString(),
                expectedReturnDate: new Date(this.checkoutExpectedReturnDate() + 'T' + this.checkoutExpectedReturnTime()).toISOString(),
                purpose: purpose || 'Quick Scan Issue',
                notes: txId
              };
              this.apiService.createAssignment(assignmentPayload).subscribe({
                next: () => { this.fetchAssignments(); },
                error: (err) => console.error('Error creating assignment in quick scan', err)
              });
            }
          },
          error: (err) => console.error('Error updating asset status in quick scan', err)
        });
      } else {
        const updated = this.assets().map(a => {
          if (a.id === details.id) {
            return { ...a, status: localStatus, custodian: mode === 'return' ? '—' : custodian };
          }
          return a;
        });
        this.assets.set(updated);
      }
    }

    const txYearMonth = new Date().toISOString().split('T')[0].substring(0, 7);
    const txId = (mode === 'issue' ? 'ISS-' : mode === 'return' ? 'RET-' : 'IST-') + txYearMonth + '-' + Math.floor(100 + Math.random() * 899);
    const tx = {
      id: txId,
      time: new Date().toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }),
      mode: modeText,
      assetName: details ? details.name : 'Scanned Asset',
      assetCode: details ? (details.assetNumber || details.id) : tag,
      issuedToInitials: custodian.split(' ').map((n: string) => n[0]).join('').toUpperCase().substring(0, 2),
      issuedToName: custodian,
      issuedToRole: assigneeType === 'Employee' ? 'Maintenance Technician' : assigneeType === 'Vehicle' ? 'Truck' : 'Internal Transfer',
      issuedToType: assigneeType.toLowerCase(),
      department: assigneeType === 'Employee' ? 'Maintenance' : assigneeType === 'Vehicle' ? 'Dispatch' : 'Production',
      purpose: purpose || 'Planned operations',
      expectedReturn: mode === 'transfer' ? '-' : (new Date(this.checkoutExpectedReturnDate()).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) + ' ' + this.checkoutExpectedReturnTime()),
      status: statusText,
      statusAuthor: 'Manoj Joshi',
      location: mode === 'transfer' ? 'Pune DC ➔ Baroda Plant' : 'Pune DC Yard',
      gpsStatus: details && details.gpsId !== '—' ? 'On' : 'Off'
    };

    this.checkoutTransactions.set([tx, ...this.checkoutTransactions()]);
    alert(`Successfully processed transaction: ${txId}\nMode: ${modeText}\nAsset: ${details ? details.name : tag}`);
    this.resetWorkflow();
  }

  protected resetWorkflow() {
    this.checkoutRfidTag.set('');
    this.checkoutPurpose.set('');
    this.checkoutAssignee.set('Amit Verma');
    this.checkoutAssigneeType.set('Employee');
    const d = new Date();
    d.setDate(d.getDate() + 7);
    this.checkoutExpectedReturnDate.set(d.toISOString().split('T')[0]);
    this.checkoutExpectedReturnTime.set('18:00');
  }

  // Legacy wrappers for safety
  protected startCheckoutScan() {
    this.simulateRfidScan();
  }
  protected removeScannedCheckoutAsset(id: string) {}
  protected processCheckout() {
    this.submitWorkflow();
  }
  protected processCheckin() {
    this.submitWorkflow();
  }

  // Work Orders Issue & Return methods
  protected quickReturnAsset(wo: any) {
    const updatedWOs = this.issueWorkOrders().map(item => {
      if (item.id === wo.id) {
        return { ...item, status: 'Returned', actualReturnDate: new Date().toLocaleDateString(), progress: 100 };
      }
      return item;
    });
    this.issueWorkOrders.set(updatedWOs);

    const asset = this.assets().find(a => a.assetNumber === wo.assetNumber);
    if (asset) {
      let catGuid = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
      if (asset.category === 'Material Handling Equipment') catGuid = 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e';
      else if (asset.category === 'IT Assets') catGuid = 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f';
      else if (asset.category === 'Vehicles') catGuid = 'd4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a';
      else if (asset.category === 'Power Equipment') catGuid = 'e5f6a7b8-c9d0-1e2f-3a4b-5c6d7e8f9a0b';
      else if (asset.category === 'Material Handling') catGuid = 'f6a7b8c9-d0e1-2f3a-4b5c-6d7e8f9a0b1c';
      else if (asset.category === 'Consumables') catGuid = 'a7b8c9d0-e1f2-3a4b-5c6d-7e8f9a0b1c2d';
      
      if (asset.id && !asset.id.startsWith('AST-MOCK')) {
        const payload = {
          id: asset.id,
          assetNumber: asset.assetNumber || asset.id,
          name: asset.name,
          description: asset.gpsId,
          serialNumber: asset.rfidTag,
          status: 'Available',
          assetCategoryId: catGuid
        };
        this.http.put(`${environment.apiUrl}/assets/${asset.id}`, payload).subscribe({
          next: () => { 
            this.fetchAssets(); 
            if (wo.id && wo.id.length === 36 && wo.id.includes('-')) {
              const user = this.authService.currentUser();
              const userId = user ? user.id : 'e1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c6d';
              const assignPayload = {
                id: wo.id,
                assetId: asset.id,
                assignedToUserId: userId,
                custodianName: wo.custodian,
                assignedDate: new Date(wo.issueDate).toISOString(),
                expectedReturnDate: wo.returnDate && wo.returnDate !== '—' ? new Date(wo.returnDate).toISOString() : new Date().toISOString(),
                actualReturnDate: new Date().toISOString(),
                purpose: wo.project,
                status: 'Returned'
              };
              this.apiService.updateAssignment(wo.id, assignPayload).subscribe({
                next: () => { this.fetchAssignments(); },
                error: (err) => console.error('Error updating assignment status', err)
              });
            }
          },
          error: (err) => console.error('Error returning asset', err)
        });
      } else {
        const updatedAssets = this.assets().map(a => {
          if (a.id === asset.id) {
            return { ...a, status: 'Available' as const };
          }
          return a;
        });
        this.assets.set(updatedAssets);
      }
    }
    alert(`Asset ${wo.assetNumber} returned and set to Available.`);
  }

  protected toggleIssueAssetSelection(asset: any) {
    const current = this.newIssueSelectedAssets();
    if (current.some(a => a.id === asset.id)) {
      this.newIssueSelectedAssets.set(current.filter(a => a.id !== asset.id));
    } else {
      this.newIssueSelectedAssets.set([...current, asset]);
    }
  }

  protected createIssueOrder() {
    const woNum = this.newIssueWorkOrder().trim() || 'WO-2025-' + Math.floor(100 + Math.random()*900);
    const proj = this.newIssueProject().trim();
    const cust = this.newIssueCustodian().trim();
    const retDate = this.newIssueExpectedReturn();
    const selected = this.newIssueSelectedAssets();

    if (selected.length === 0) {
      alert('Please select at least one asset to issue.');
      return;
    }
    if (!proj || !cust) {
      alert('Please fill out Project and Custodian fields.');
      return;
    }

    selected.forEach(asset => {
      const newWO = {
        id: selected.length > 1 ? `${woNum}-${asset.assetNumber || asset.id}` : woNum,
        assetNumber: asset.assetNumber || asset.id,
        assetName: asset.name,
        custodian: cust,
        project: proj,
        issueDate: new Date().toLocaleDateString(),
        returnDate: new Date(retDate).toLocaleDateString(),
        status: 'Active',
        progress: 0
      };
      this.issueWorkOrders.set([newWO, ...this.issueWorkOrders()]);

      let catGuid = 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d';
      if (asset.category === 'Material Handling Equipment') catGuid = 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e';
      else if (asset.category === 'IT Assets') catGuid = 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f';
      else if (asset.category === 'Vehicles') catGuid = 'd4e5f6a7-b8c9-0d1e-2f3a-4b5c6d7e8f9a';
      else if (asset.category === 'Power Equipment') catGuid = 'e5f6a7b8-c9d0-1e2f-3a4b-5c6d7e8f9a0b';
      else if (asset.category === 'Material Handling') catGuid = 'f6a7b8c9-d0e1-2f3a-4b5c-6d7e8f9a0b1c';
      else if (asset.category === 'Consumables') catGuid = 'a7b8c9d0-e1f2-3a4b-5c6d-7e8f9a0b1c2d';

      if (asset.id && !asset.id.startsWith('AST-MOCK')) {
        const payload = {
          id: asset.id,
          assetNumber: asset.assetNumber || asset.id,
          name: asset.name,
          description: asset.gpsId,
          serialNumber: asset.rfidTag,
          status: 'Assigned',
          assetCategoryId: catGuid
        };
        this.http.put(`${environment.apiUrl}/assets/${asset.id}`, payload).subscribe({
          next: () => { 
            this.fetchAssets(); 
            const user = this.authService.currentUser();
            const userId = user ? user.id : 'e1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c6d';
            const assignmentPayload = {
              assetId: asset.id,
              assignedToUserId: userId,
              custodianName: cust,
              assignedDate: new Date().toISOString(),
              expectedReturnDate: retDate ? new Date(retDate).toISOString() : new Date().toISOString(),
              purpose: proj,
              notes: woNum
            };
            this.apiService.createAssignment(assignmentPayload).subscribe({
              next: () => { this.fetchAssignments(); },
              error: (err) => console.error('Error creating assignment', err)
            });
          },
          error: (err) => console.error('Error issuing asset', err)
        });
      } else {
        const updatedAssets = this.assets().map(a => {
          if (a.id === asset.id) {
            return { ...a, status: 'In Use' as const, custodian: cust };
          }
          return a;
        });
        this.assets.set(updatedAssets);
      }
    });

    alert(`Successfully issued ${selected.length} asset(s) for Work Order ${woNum}.`);
    this.newIssueWorkOrder.set('');
    this.newIssueProject.set('');
    this.newIssueCustodian.set('');
    this.newIssueSelectedAssets.set([]);
    this.issueActiveTab.set('active');
  }
}
