import { Component, signal, computed, effect, ElementRef, ViewChild, AfterViewInit, OnDestroy, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser, DecimalPipe } from '@angular/common';
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
  imports: [DecimalPipe, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements AfterViewInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly apiService = inject(ApiService);
  
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
    { name: 'Alerts & Exceptions', icon: 'notifications', badge: '23', submenus: null },
    { name: 'Reports & Analytics', icon: 'bar_chart', badge: null, submenus: [] },
    { name: 'Compliance', icon: 'assignment_turned_in', badge: null, submenus: ['Audit & Inspections', 'Geofence Violations', 'Certificates & Licenses'] },
    { name: 'Integrations', icon: 'hub', badge: null, submenus: null },
    { name: 'Admin', icon: 'admin_panel_settings', badge: null, submenus: ['User Management', 'System Settings', 'Reader Profiles', 'API Management'] }
  ];

  // State Signals
  protected readonly isLoggedIn = signal<boolean>(false);
  protected readonly loginUsername = signal<string>('');
  protected readonly loginPassword = signal<string>('');
  protected readonly loginRememberMe = signal<boolean>(true);
  protected readonly loginErrorMessage = signal<string>('');
  protected readonly showPassword = signal<boolean>(false);

  protected readonly selectedSite = signal<string>('Pune DC');
  protected readonly activeOperation = signal<string>('All Operations');
  protected readonly activeNav = signal<string>('Dashboard');
  protected readonly activeSubNav = signal<string>('');
  
  protected readonly selectedDate = signal<string>('2025-05-20');
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
  
  // Reports & Analytics Page State
  protected readonly reportsSelectedSubnav = signal<string>('Operations');
  protected readonly reportsDateRange = signal<string>('01 May 2025 - 20 May 2025');
  protected readonly reportsSelectedSite = signal<string>('All Sites');
  protected readonly reportsSelectedCategory = signal<string>('All Categories');
  protected readonly reportsSelectedDepartment = signal<string>('All Departments');
  protected readonly reportsSelectedCustomerVendor = signal<string>('All');
  protected readonly reportsExpandedSites = signal<Record<string, boolean>>({
    'India Operations (All Sites)': true
  });
  protected readonly reportsDataRefreshedTime = signal<string>('20 May 2025, 10:24 AM');
  protected readonly reportsIndiaOpsDropdownOpen = signal<boolean>(false);
  protected readonly expandedItems = signal<Record<string, boolean>>({ 'Assets': true });
  protected readonly isSiteDropdownOpen = signal<boolean>(false);
  protected readonly isNotificationOpen = signal<boolean>(false);
  protected readonly searchQuery = signal<string>('');
  protected readonly currentTheme = signal<string>('light');

  // Compliance State
  protected readonly complianceScore = signal<number>(0);
  protected readonly complianceAudits = signal<any[]>([]);
  protected readonly complianceGeofenceViolations = signal<any[]>([]);
  protected readonly complianceCertificates = signal<any[]>([]);

  // Integrations State
  protected readonly integrations = signal<any[]>([]);

  // Admin State
  protected readonly adminUsers = signal<any[]>([]);
  protected readonly adminReaders = signal<any[]>([]);
  protected readonly adminApiKeys = signal<any[]>([]);

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
  protected formUserIsActive = true;

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
  protected readonly checkoutExpectedReturn = signal<string>('2025-05-30');
  protected readonly checkoutScannedAssets = signal<any[]>([]);
  protected readonly isCheckoutScanning = signal<boolean>(false);
  
  protected readonly checkoutCategory = signal<string>('Tool Room Tools');
  protected readonly checkoutRfidTag = signal<string>('');
  protected readonly checkoutAssigneeType = signal<string>('Employee');
  protected readonly checkoutAssignee = signal<string>('Amit Verma');
  protected readonly checkoutPurpose = signal<string>('');
  protected readonly checkoutExpectedReturnDate = signal<string>('2025-05-27');
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
        nextMaintenance: '25 Jun 2025'
      } as Asset;
    }
    return null;
  });

  protected readonly checkoutFilter = signal<string>('All');
  protected readonly checkoutRecords = signal<any[]>([]);
  protected readonly checkinRecords = signal<any[]>([]);

  protected readonly checkoutFilterOptions = computed(() => {
    const names = new Set<string>();
    this.checkoutRecords().forEach(r => names.add(r.equipment));
    this.checkinRecords().forEach(r => names.add(r.equipment));
    return ['All', ...Array.from(names)];
  });

  protected readonly filteredCheckoutRecords = computed(() => {
    const f = this.checkoutFilter();
    if (f === 'All') return this.checkoutRecords();
    return this.checkoutRecords().filter(r => r.equipment === f);
  });

  protected readonly filteredCheckinRecords = computed(() => {
    const f = this.checkoutFilter();
    if (f === 'All') return this.checkinRecords();
    return this.checkinRecords().filter(r => r.equipment === f);
  });

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
  protected readonly newIssueExpectedReturn = signal<string>('2025-05-30');
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
    const list = this.inventoryItems();
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
    let list = this.maintAlerts();

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
  protected readonly selectedCalendarDay = signal<number>(20);

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
        rfid: this.http.get<any>('http://localhost:5025/api/rfidtags?page=1&size=200'),
        barcode: this.http.get<any>('http://localhost:5025/api/barcodes?page=1&size=200'),
        gps: this.http.get<any>('http://localhost:5025/api/gpsdevices?page=1&size=200')
      }).subscribe({
        next: (res) => {
          const list: any[] = [];

          // 1. Add RFID tags
          const rfidList: any[] = Array.isArray(res.rfid) ? res.rfid : (res.rfid?.body ?? []);
          if (Array.isArray(rfidList)) {
            rfidList.forEach(t => {
              const asset = this.assets().find(a => a.id === t.assetId);
              list.push({
                id: t.id,
                epc: t.epcCode,
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
              const asset = this.assets().find(a => a.id === b.assetId);
              list.push({
                id: b.id,
                epc: b.barcodeValue,
                assetNumber: asset ? asset.assetNumber : '-',
                assetName: asset ? asset.name : 'Unassigned',
                type: 'Barcode ' + b.format,
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
              const asset = this.assets().find(a => a.id === g.assetId);
              list.push({
                id: g.id,
                epc: g.imei,
                assetNumber: asset ? asset.assetNumber : '-',
                assetName: asset ? asset.name : 'Unassigned',
                type: 'GPS Active Device',
                RSSI: '-72 dBm',
                battery: g.batteryLevel + '%',
                lastSeen: 'GPS Network',
                time: 'Just now',
                status: g.status === 'Online' ? 'Active' : 'Inactive',
                rawType: 'GPS'
              });
            });
            this.gpsDevicesPool.set(gpsList);
          }

          this.tagsList.set(list);
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
    let url = 'http://localhost:5025/api/rfidtags';
    let payload: any = {};

    if (type === 'RFID') {
      payload = {
        epcCode: epc,
        tidCode: null,
        assetId: resolvedAssetGuid,
        status: this.newTagStatus()
      };
    } else if (type === 'Barcode') {
      url = 'http://localhost:5025/api/barcodes';
      payload = {
        barcodeValue: epc,
        format: 'Code128',
        assetId: resolvedAssetGuid,
        isActive: this.newTagStatus() === 'Active'
      };
    } else if (type === 'GPS') {
      url = 'http://localhost:5025/api/gpsdevices';
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
        alert('Failed to register tag');
      }
    });
  }

  protected decommissionTag(epc: string) {
    if (confirm(`Are you sure you want to decommission tag ${epc}?`)) {
      const tag = this.tagsList().find(t => t.epc === epc);
      if (tag && tag.id) {
        let url = 'http://localhost:5025/api/rfidtags';
        if (tag.rawType === 'Barcode') url = 'http://localhost:5025/api/barcodes';
        else if (tag.rawType === 'GPS') url = 'http://localhost:5025/api/gpsdevices';

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
        this.http.put(`http://localhost:5025/api/rfidtags/${tag.id}`, payload).subscribe({
          next: () => this.fetchTags(),
          error: (err) => console.error('Failed to toggle RFID status', err)
        });
      } else if (tag.rawType === 'Barcode') {
        const matchedPool = this.barcodesPool().find(b => b.id === tag.id);
        const payload = {
          ...matchedPool,
          isActive: !matchedPool.isActive
        };
        this.http.put(`http://localhost:5025/api/barcodes/${tag.id}`, payload).subscribe({
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
        this.http.put(`http://localhost:5025/api/gpsdevices/${tag.id}`, payload).subscribe({
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
      this.handheldSessionsList.set(this.handheldSessionsList().map(s => {
        if (s.id === id) {
          return { ...s, status: 'Completed', duration: 'Completed' };
        }
        return s;
      }));
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
  protected readonly gpsShowGeofences = signal<boolean>(true);
  protected readonly gpsAutoRefresh = signal<boolean>(true);
  protected readonly gpsRefreshInterval = signal<number>(10);
  protected readonly gpsSelectedAsset = signal<GPSAsset | null>(null);

  // Stats signals
  protected readonly gpsTotalAssets = signal<number>(128);
  protected readonly gpsMovingCount = signal<number>(46);
  protected readonly gpsIdleCount = signal<number>(32);
  protected readonly gpsStoppedCount = signal<number>(28);
  protected readonly gpsLowBatteryCount = signal<number>(6);
  protected readonly gpsExceptionCount = signal<number>(4);
  protected readonly gpsOfflineCount = signal<number>(12);

  // GPS Mock Assets
  protected readonly gpsAssets = signal<GPSAsset[]>([]);

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

    list = list.filter(a => activeGpsIds.includes(a.tag));

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
          if (status === 'Offline') return false; // simulated mock list has no offline items
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

  protected readonly totalInventoryCount = computed(() => this.assets().length);
  protected readonly serializedAssetsCount = computed(() => this.assets().filter(a => a.assetType === 'Serialized').length);
  protected readonly returnableAssetsCount = computed(() => this.assets().filter(a => a.assetType === 'Returnable').length);
  protected readonly gpsEnabledAssetsCount = computed(() => this.gpsAssets().length);

  protected readonly warehouseAssetsCount = computed(() => this.assets().filter(a => a.site?.includes('DC') || a.site?.includes('Warehouse')).length);
  protected readonly manufacturingAssetsCount = computed(() => this.assets().filter(a => a.site?.includes('Plant')).length);
  protected readonly distributionCenterAssetsCount = computed(() => this.assets().filter(a => a.site?.includes('Hub')).length);

  protected readonly inUseAssetsCount = computed(() => this.assets().filter(a => a.status === 'In Use').length);
  protected readonly availableAssetsCount = computed(() => this.assets().filter(a => a.status === 'Available').length);
  protected readonly checkedOutAssetsCount = computed(() => this.assets().filter(a => a.status === 'Checked Out').length);
  protected readonly underMaintenanceAssetsCount = computed(() => this.assets().filter(a => a.status === 'Under Maintenance').length);

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
  protected readonly apiSites = signal<any[]>([]);
  protected readonly apiWarehouses = signal<any[]>([]);
  protected readonly apiZones = signal<any[]>([]);

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
  protected readonly activeAssetStatus = signal<string>('');
  protected readonly assetSearchQuery = signal<string>('');
  protected readonly showAssetFilters = signal<boolean>(false);

  protected readonly filteredAssets = computed(() => {
    const q = this.assetSearchQuery().toLowerCase();
    const siteFilter = this.activeAssetSite();
    const statusFilter = this.activeAssetStatus();
    const list = this.assets();
    
    // Set first matched asset as selected if current selection is not in filtered list
    const res = list.filter(asset => {
      const matchesSearch = !q ||
        asset.id.toLowerCase().includes(q) ||
        asset.name.toLowerCase().includes(q) ||
        asset.rfidTag.toLowerCase().includes(q) ||
        asset.gpsId.toLowerCase().includes(q) ||
        (asset.custodian && asset.custodian.toLowerCase().includes(q));
      
      if (!matchesSearch) return false;
      
      if (siteFilter !== 'All Assets') {
        if (siteFilter === 'Warehouse' && !asset.site?.includes('DC') && !asset.site?.includes('Warehouse')) return false;
        if (siteFilter === 'Manufacturing' && !asset.site?.includes('Plant')) return false;
        if (siteFilter === 'Distribution Center' && !asset.site?.includes('Hub')) return false;
      }
      
      if (statusFilter && asset.status !== statusFilter) return false;
      
      return true;
    });

    // Make sure we select the first one if none selected or if selection not in matching list
    setTimeout(() => {
      const curr = this.selectedAsset();
      if (res.length > 0 && (!curr || !res.some(a => a.id === curr.id))) {
        this.selectedAsset.set(res[0]);
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
  
  protected simulateFileUpload() {
    this.isBulkFileUploaded.set(true);
  }
  
  protected cancelUpload() {
    this.isBulkFileUploaded.set(false);
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
  protected currentStats = signal<SiteStats>(this.siteData['Pune DC']);

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
      const savedLogin = localStorage.getItem('isLoggedIn');
      if (savedLogin === 'true') {
        this.isLoggedIn.set(true);
        this.loadAllApiData();
      }
      
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
    
    // Set default selected GPS asset
    if (this.gpsAssets().length > 0) {
      this.gpsSelectedAsset.set(this.gpsAssets()[0]);
    }

    // Set default selected Maintenance alert to null (starts closed)
    this.maintSelectedAlert.set(null);

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

    // React to selectedSite changes to update numbers and rebuild charts
    effect(() => {
      const site = this.selectedSite();
      const newStats = this.siteData[site] || this.siteData['Pune DC'];
      this.currentStats.set(newStats);
      
      // Update charts on site change (if already initialized in browser)
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
          this.startGpsSimulation();
        }
      }
    });
  }

  protected fetchCategories(callback?: () => void) {
    if (!this.isLoggedIn()) return;
    this.http.get<any[]>('http://localhost:5025/api/categories').subscribe({
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
    this.http.get<any[]>('http://localhost:5025/api/assets').subscribe({
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
          const linkedRfid = rfidPool.find(t => t.assetId === item.id);
          const linkedBarcode = bcPool.find(b => b.assetId === item.id);
          const linkedGps = gpsPool.find(g => g.assetId === item.id);

          return {
            id: item.id,
            assetNumber: item.assetNumber || item.id,
            name: item.name,
            rfidTag: linkedRfid ? linkedRfid.epcCode : '—',
            qrCode: linkedBarcode ? linkedBarcode.barcodeValue : (item.qrCode || '—'),
            gpsId: linkedGps ? linkedGps.imei : '—',
            serialNumber: item.serialNumber || '—',
            category: category,
            group: item.group || '—',
            manufacturer: item.manufacturer || '—',
            model: item.model || '—',
            purchaseDate: item.purchaseDate ? new Date(item.purchaseDate).toLocaleDateString() : '—',
            warranty: item.warrantyExpiryDate ? new Date(item.warrantyExpiryDate).toLocaleDateString() : '—',
            status: status,
            currentLocation: item.currentLocation || 'Pune DC',
            custodian: item.currentCustodian || 'Unassigned',
            currentCustodian: item.currentCustodian || 'Unassigned',
            ownerDepartment: item.ownerDepartment || '—',
            industry: item.industry || '—',
            businessUnit: item.businessUnit || '—',
            site: item.siteId ? (item.siteId === 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c91' ? 'Pune DC' :
                                 item.siteId === 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c92' ? 'Mumbai Warehouse' :
                                 item.siteId === 'f1a2b3c4-d5e6-7a8b-9c0d-1e2f3a4b5c93' ? 'Chennai Plant' : 'Bengaluru Hub') : '—',
            zone: item.zoneId ? 'Zone A' : '—',
            assetType: item.assetType || 'Serialized',
            lastSeen: '—',
            nextMaintenance: '—',
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
            serviceHistory: []
          };
        });

        this.assets.set(mapped);
        
        const allAssets = mapped;
        const statusCategory = [
          allAssets.filter(a => a.status === 'In Use').length,
          allAssets.filter(a => a.status === 'Available').length,
          allAssets.filter(a => a.status === 'Under Maintenance').length,
          allAssets.filter(a => a.status === 'Checked Out').length,
          0
        ];

        const topCategories = [
          allAssets.filter(a => a.category === 'Returnable Container').length,
          allAssets.filter(a => a.category === 'Material Handling Equipment').length,
          allAssets.filter(a => a.category === 'Power Equipment').length,
          allAssets.filter(a => a.category === 'IT Assets').length,
          allAssets.filter(a => a.category === 'Vehicles').length,
          allAssets.filter(a => a.category === 'Consumables').length
        ];

        const totalAll = allAssets.length;
        const inUseAll = allAssets.filter(a => a.status === 'In Use').length;
        const availableAll = allAssets.filter(a => a.status === 'Available').length;
        const maintAll = allAssets.filter(a => a.status === 'Under Maintenance').length;
        const checkedOutAll = allAssets.filter(a => a.status === 'Checked Out').length;
        const activeAll = inUseAll + availableAll + maintAll;
        const activePctAll = totalAll > 0 ? ((activeAll / totalAll) * 100).toFixed(1) + '%' : '0%';
        const inUsePctAll = totalAll > 0 ? ((inUseAll / totalAll) * 100).toFixed(1) + '%' : '0%';
        const maintPctAll = totalAll > 0 ? ((maintAll / totalAll) * 100).toFixed(1) + '%' : '0%';

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
          statusCategory,
          topCategories
        };

        const sites = ['Pune DC', 'Mumbai Warehouse', 'Chennai Plant', 'Bengaluru Hub'];
        sites.forEach(siteName => {
          const siteAssets = allAssets.filter(a => a.site === siteName);
          const totalS = siteAssets.length;
          const inUseS = siteAssets.filter(a => a.status === 'In Use').length;
          const availableS = siteAssets.filter(a => a.status === 'Available').length;
          const maintS = siteAssets.filter(a => a.status === 'Under Maintenance').length;
          const checkedOutS = siteAssets.filter(a => a.status === 'Checked Out').length;
          const activeS = inUseS + availableS + maintS;
          const activePctS = totalS > 0 ? ((activeS / totalS) * 100).toFixed(1) + '%' : '0%';
          const inUsePctS = totalS > 0 ? ((inUseS / totalS) * 100).toFixed(1) + '%' : '0%';
          const maintPctS = totalS > 0 ? ((maintS / totalS) * 100).toFixed(1) + '%' : '0%';

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
            statusCategory: [
              inUseS,
              availableS,
              maintS,
              checkedOutS,
              0
            ],
            topCategories: [
              siteAssets.filter(a => a.category === 'Returnable Container').length,
              siteAssets.filter(a => a.category === 'Material Handling Equipment').length,
              siteAssets.filter(a => a.category === 'Power Equipment').length,
              siteAssets.filter(a => a.category === 'IT Assets').length,
              siteAssets.filter(a => a.category === 'Vehicles').length,
              siteAssets.filter(a => a.category === 'Consumables').length
            ]
          };
        });

        const selected = this.selectedSite();
        if (this.siteData[selected]) {
          this.currentStats.set({ ...this.siteData[selected] });
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
    this.formSiteId.set('');
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
      this.http.post('http://localhost:5025/api/assets', payload).subscribe({
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
      this.http.put(`http://localhost:5025/api/assets/${this.modalAssetId()}`, editPayload).subscribe({
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
    let url = 'http://localhost:5025/api/rfidtags';
    if (type === 'RFID') url = 'http://localhost:5025/api/rfidtags';
    else if (type === 'Barcode') url = 'http://localhost:5025/api/barcodes';
    else if (type === 'GPS') url = 'http://localhost:5025/api/gpsdevices';

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
        this.http.put(`http://localhost:5025/api/rfidtags/${tag.id}`, { ...tag, assetId }).subscribe();
      } else if (!shouldBeLinked && isCurrentlyLinked) {
        this.http.put(`http://localhost:5025/api/rfidtags/${tag.id}`, { ...tag, assetId: null }).subscribe();
      }
    });

    // 2. Sync Barcode
    this.barcodesPool().forEach(bc => {
      const shouldBeLinked = bc.barcodeValue === barcodeVal;
      const isCurrentlyLinked = bc.assetId === assetId;
      if (shouldBeLinked && !isCurrentlyLinked) {
        this.http.put(`http://localhost:5025/api/barcodes/${bc.id}`, { ...bc, assetId }).subscribe();
      } else if (!shouldBeLinked && isCurrentlyLinked) {
        this.http.put(`http://localhost:5025/api/barcodes/${bc.id}`, { ...bc, assetId: null }).subscribe();
      }
    });

    // 3. Sync GPS Device
    this.gpsDevicesPool().forEach(dev => {
      const shouldBeLinked = dev.imei === gpsImei;
      const isCurrentlyLinked = dev.assetId === assetId;
      if (shouldBeLinked && !isCurrentlyLinked) {
        this.http.put(`http://localhost:5025/api/gpsdevices/${dev.id}`, { ...dev, assetId }).subscribe();
      } else if (!shouldBeLinked && isCurrentlyLinked) {
        this.http.put(`http://localhost:5025/api/gpsdevices/${dev.id}`, { ...dev, assetId: null }).subscribe();
      }
    });
  }

  protected deleteAsset(id: string) {
    if (!confirm('Are you sure you want to delete this asset?')) {
      return;
    }
    this.http.delete(`http://localhost:5025/api/assets/${id}`).subscribe({
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

    this.http.put(`http://localhost:5025/api/assets/${asset.id}`, payload).subscribe({
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
    this.http.post('http://localhost:5025/api/categories', payload).subscribe({
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
    this.http.delete(`http://localhost:5025/api/categories/${id}`).subscribe({
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

  protected startScanSession() {
    this.isScanSessionRunning.set(true);
    this.startScanPolling();
  }

  protected pauseScanSession() {
    this.isScanSessionRunning.set(false);
    this.stopScanPolling();
  }

  protected stopScanSession() {
    this.isScanSessionRunning.set(false);
    this.scanSessionTime.set('00:00:00');
    this.stopScanPolling();
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

  protected fetchScanEvents() {
    this.apiService.getScanEvents().subscribe({
      next: (res) => {
        const list = res || [];
        if (Array.isArray(list)) {
          this.scanEventsList.set(list.map((e: any, index: number) => {
            const asset = this.assets().find(a => a.rfidTag === e.epcCode || a.assetNumber === e.epcCode);
            return {
              index: index + 1,
              epc: e.epcCode,
              assetId: asset ? asset.assetNumber : 'Unassigned EPC',
              assetName: asset ? asset.name : 'Unknown Asset',
              time: new Date(e.timestamp).toLocaleTimeString(),
              antenna: 'A' + e.antennaIndex,
              rssi: e.rssi + ' dBm',
              direction: 'IN',
              status: e.status || 'Matched',
              source: e.readerName || e.handheldDeviceName || 'Fixed Reader'
            };
          }));

          this.scanTotalReadCount.set(list.length);
          this.scanExceptionDuplicate.set(list.filter((e: any) => e.status === 'Duplicate').length);
          this.scanExceptionUnknown.set(list.filter((e: any) => e.status === 'Unmatched' || e.status === 'Unknown').length);

          const gateCount = list.filter((e: any) => e.readerName && e.readerName.includes('Gate')).length;
          const handheldCount = list.filter((e: any) => e.handheldDeviceName).length;
          this.activeGateReaderReads.set(gateCount);
          this.activeHandheldReaderReads.set(handheldCount);
        }
      },
      error: (err) => console.error('Failed to load scan events from PostgreSQL', err)
    });
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

      // 2. Scan Events Simulation Interval
      const assetIds = ['RM-STEEL-COIL-1026', 'RM-STEEL-COIL-1027', 'RM-CHEM-DRUM-8891', 'PALLET-PL-334456', 'TOOL-BOX-TB-0913', 'RM-AL-PLATE-5567', 'FG-PUMP-SET-5568'];
      const sources = ['Gate Reader', 'Forklift Reader', 'Handheld Reader'];
      const directions = ['IN', 'OUT'];
      const antennas = ['A1', 'A2', 'A3', 'A4'];

      this.scanSessionInterval = setInterval(() => {
        if (!this.isScanSessionRunning()) return;

        // Generate dynamic scan
        const source = sources[Math.floor(Math.random() * sources.length)];
        const direction = directions[Math.random() > 0.3 ? 0 : 1];
        const antenna = antennas[Math.floor(Math.random() * antennas.length)];
        const rssi = -55 - Math.floor(Math.random() * 20);

        let status = 'Matched';
        let assetId = assetIds[Math.floor(Math.random() * assetIds.length)];
        let epc = 'E28011702000021A3F4B2' + Math.floor(100 + Math.random() * 899).toString(16).toUpperCase();

        const rand = Math.random();
        if (rand > 0.85) {
          status = 'Duplicate';
          this.scanExceptionDuplicate.update(c => c + 1);
        } else if (rand > 0.75) {
          status = 'Unmatched';
          assetId = 'UNKNOWN TAG';
          epc = 'E2809999' + Math.floor(10000000 + Math.random() * 89999999).toString(16).toUpperCase();
          this.scanExceptionUnknown.update(c => c + 1);
        } else if (rand > 0.7) {
          status = 'Matched';
          // Simulate dynamic alert tags or movements
          if (Math.random() > 0.5) {
            this.scanExceptionUnauthorized.update(c => c + 1);
          }
        }

        // Add scan to list
        const currentList = [...this.scanEventsList()];
        const nextIndex = currentList.length + 1;
        const now = new Date();
        const dateStr = `20 May 2025, ${now.toLocaleTimeString('en-US', { hour12: true })} IST`;

        const newEvent = {
          index: nextIndex,
          epc,
          assetId,
          time: dateStr,
          antenna,
          rssi,
          direction,
          status,
          source
        };

        this.scanEventsList.set([newEvent, ...currentList]);

        // Increment stats
        this.scanTotalReadCount.update(c => c + 1);
        if (source === 'Gate Reader') {
          this.activeGateReaderReads.update(c => c + 1);
        } else if (source === 'Handheld Reader') {
          this.activeHandheldReaderReads.update(c => c + 1);
        } else if (source === 'Forklift Reader') {
          this.activeForkliftReaderReads.update(c => c + 1);
        }
      }, 3500); // add one scan event every 3.5 seconds
    }
  }

  protected loadAllApiData() {
    if (!this.isLoggedIn()) return;

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
            antennas: r.antennas || 4,
            powerDbm: r.powerDbm || 30,
            ipAddress: r.ipAddress,
            status: r.status || 'Online'
          })));

          this.fixedReadersList.set(list.map(r => ({
            id: r.id,
            name: r.name,
            model: r.model || 'Zebra FX9600',
            status: r.status || 'Online',
            ipAddress: r.ipAddress,
            macAddress: r.macAddress || '00:11:22:33:44:55',
            powerLevel: (r.powerDbm || 30) + ' dBm',
            lastActive: 'Just now',
            antennas: Array.from({ length: r.antennas || 4 }, (_, i) => `Antenna ${i + 1}: OK`)
          })));
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
                maintenancePct: maintPct
              };
            }
          });

          // Aggregate All Sites stats dynamically
          let aggTotal = 0;
          let aggInUse = 0;
          let aggAvailable = 0;
          let aggMaintenance = 0;
          res.siteStats.forEach((s: any) => {
            aggTotal += s.total;
            aggInUse += s.inUse;
            aggAvailable += s.available;
            aggMaintenance += s.maintenance;
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
            maintenancePct: aggMaintPct
          };

          const selected = this.selectedSite();
          if (this.siteData[selected]) {
            this.currentStats.set({ ...this.siteData[selected] });
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

    this.fetchAssignments();
    this.fetchAlerts();
    this.fetchSitesZonesWarehouses();
    // Categories must load first, which then triggers fetchAssets
    this.fetchCategories(() => {
      // After categories are loaded, load tags then assets (so tag pools are ready for asset mapping)
      this.fetchTagsThenAssets();
    });
  }

  protected fetchSitesZonesWarehouses() {
    if (!this.isLoggedIn()) return;
    this.http.get<any[]>('http://localhost:5025/api/sites?page=1&size=200').subscribe({
      next: (data) => { 
        if (Array.isArray(data)) {
          this.apiSites.set(data);
          data.forEach(s => {
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
        }
      },
      error: (err) => console.error('Failed to load sites', err)
    });
    this.http.get<any[]>('http://localhost:5025/api/warehouses?page=1&size=200').subscribe({
      next: (data) => { if (Array.isArray(data)) this.apiWarehouses.set(data); },
      error: (err) => console.error('Failed to load warehouses', err)
    });
    this.http.get<any[]>('http://localhost:5025/api/zones?page=1&size=200').subscribe({
      next: (data) => { if (Array.isArray(data)) this.apiZones.set(data); },
      error: (err) => console.error('Failed to load zones', err)
    });
  }

  protected fetchTagsThenAssets() {
    if (!this.isLoggedIn()) return;
    import('rxjs').then(({ forkJoin }) => {
      forkJoin({
        rfid: this.http.get<any>('http://localhost:5025/api/rfidtags?page=1&size=200'),
        barcode: this.http.get<any>('http://localhost:5025/api/barcodes?page=1&size=200'),
        gps: this.http.get<any>('http://localhost:5025/api/gpsdevices?page=1&size=200')
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
    if (!this.isLoggedIn()) return;
    this.apiService.getAssignments().subscribe({
      next: (res) => {
        const list = res.body || res;
        if (Array.isArray(list)) {
          this.issueWorkOrders.set(list.map(a => {
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

          const checkouts: any[] = [];
          const checkins: any[] = [];
          list.forEach(a => {
            const isReturned = a.actualReturnDate != null || a.status === 'Returned';
            const item = {
              entity: a.custodianName || a.assignedToUsername || 'System',
              equipment: a.assetName || (a.asset ? a.asset.name : 'Unknown Equipment'),
              type: 'HandHeld Reader',
              epc: a.asset ? a.asset.rfidTag : (a.assetNumber || 'Unknown EPC'),
              detected: '-',
              time: new Date(a.assignedDate).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }),
              gateStatus: isReturned ? 'Passed' : '-',
              checkinTime: a.actualReturnDate ? new Date(a.actualReturnDate).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '-',
              raw: a
            };
            if (isReturned) {
              checkins.push(item);
            } else {
              checkouts.push(item);
            }
          });
          this.checkoutRecords.set(checkouts);
          this.checkinRecords.set(checkins);
        }
      },
      error: (err) => {
        console.error('Failed to fetch assignments', err);
      }
    });
  }



  ngAfterViewInit() {
    if (isPlatformBrowser(this.platformId)) {
      this.buildCharts();
      
      // Start periodic mock event injector to make it feel alive!
      // this.startEventSimulation();

      // Start RFID scan session simulation!
      // this.startScanSessionSimulation();
    }
  }

  ngOnDestroy() {
    this.destroyCharts();
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
  }

  // Action Methods
  protected onSignIn(event?: Event) {
    if (event) {
      event.preventDefault();
    }
    const username = this.loginUsername().trim();
    const password = this.loginPassword().trim();
    if (!username || !password) {
      this.loginErrorMessage.set('Please enter both username and password.');
      return;
    }
    this.authService.login({ username, password }).subscribe({
      next: () => {
        this.loginErrorMessage.set('');
        this.isLoggedIn.set(true);
        this.loadAllApiData();
        setTimeout(() => {
          this.destroyCharts();
          this.buildCharts();
        }, 100);
      },
      error: (err) => {
        if (err.status === 0) {
          this.loginErrorMessage.set('Unable to connect to the server. Please ensure the backend API is running.');
        } else {
          this.loginErrorMessage.set(err.error?.message || (typeof err.error === 'string' ? err.error : null) || 'Invalid username or password.');
        }
      }
    });
  }

  protected onLoginWithDevice() {
    this.loginErrorMessage.set('RFID scanner device not detected. Please connect your USB/Bluetooth scanner or enter your credentials.');
  }

  protected onSignOut() {
    this.authService.logout().subscribe({
      next: () => {
        this.isLoggedIn.set(false);
        this.loginUsername.set('');
        this.loginPassword.set('');
        if (isPlatformBrowser(this.platformId)) {
          this.authService.clearStorage();
          localStorage.removeItem('isLoggedIn');
          localStorage.removeItem('activeNav');
          localStorage.removeItem('activeSubNav');
        }
      },
      error: () => {
        this.authService.clearStorage();
        this.isLoggedIn.set(false);
        this.loginUsername.set('');
        this.loginPassword.set('');
        if (isPlatformBrowser(this.platformId)) {
          localStorage.removeItem('isLoggedIn');
          localStorage.removeItem('activeNav');
          localStorage.removeItem('activeSubNav');
        }
      }
    });
  }

  protected selectSite(site: string) {
    this.selectedSite.set(site);
    this.isSiteDropdownOpen.set(false);
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
    const item = this.navItems.find(n => n.name === nav);
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

    if (nav === 'Dashboard') {
      this.loadAllApiData();
    } else if (nav === 'Assets') {
      this.fetchAssets();
    } else if (nav === 'Check in/Check out') {
      this.fetchAssignments();
    } else if (nav === 'GPS Tracking') {
      this.fetchLiveGpsLocations();
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
    }
  }

  protected toggleSiteDropdown() {
    this.isSiteDropdownOpen.update(v => !v);
    this.isNotificationOpen.set(false);
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
    setTimeout(() => {
      // Perturb stats slightly to look like actual update
      const site = this.selectedSite();
      const base = this.siteData[site];
      if (base) {
        const delta = Math.floor(Math.random() * 20) - 10;
        const total = base.totalAssets + delta;
        const active = base.activeAssets + Math.floor(delta * 0.9);
        const inUse = base.assetsInUse + Math.floor(delta * 0.68);
        
        this.currentStats.update(s => ({
          ...s,
          totalAssets: total,
          activeAssets: active,
          assetsInUse: inUse,
          rfidReadsToday: s.rfidReadsToday + Math.floor(Math.random() * 1500),
          gpsPingsToday: s.gpsPingsToday + Math.floor(Math.random() * 3000),
        }));
      }

      this.destroyCharts();
      this.buildCharts();
      this.isLoading.set(false);
    }, 800);
  }

  protected clearNotifications() {
    this.notifications.set([]);
  }

  protected markNotificationsRead() {
    this.notifications.update(list => list.map(n => ({ ...n, read: true })));
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
        
        // Bump site stats slightly
        this.currentStats.update(s => {
          let rfidCount = s.rfidReadsToday;
          let gpsCount = s.gpsPingsToday;
          let excCount = s.exceptionAlerts;
          
          if (type === 'RFID Read') rfidCount += 1;
          else if (type === 'GPS Ping') gpsCount += 1;
          else excCount += 1;
          
          return {
            ...s,
            rfidReadsToday: rfidCount,
            gpsPingsToday: gpsCount,
            exceptionAlerts: excCount
          };
        });
      }
    }, 6000);
  }

  // Filtered Events computed helper
  protected get filteredEvents(): EventItem[] {
    const q = this.searchQuery().toLowerCase();
    const op = this.activeOperation();
    const site = this.selectedSite();
    
    return this.allEvents().filter(ev => {
      // 1. Search Query filter
      const matchesSearch = !q || 
        ev.assetId.toLowerCase().includes(q) ||
        ev.assetName.toLowerCase().includes(q) ||
        ev.location.toLowerCase().includes(q) ||
        ev.category.toLowerCase().includes(q) ||
        ev.operator.toLowerCase().includes(q) ||
        ev.details.toLowerCase().includes(q);
        
      if (!matchesSearch) return false;
      
      // 2. Site selection filter (Recent Events list contains items from different sites. Let's filter matches where site matches event location name)
      if (site !== 'All Sites') {
        const siteClean = site.split(' ')[0]; // 'Pune', 'Mumbai', 'Chennai', 'Bengaluru'
        if (!ev.location.includes(siteClean)) return false;
      }
      
      // 3. Operation Category filter
      if (op === 'Warehouse') {
        return ev.category === 'Returnable Container' || ev.category === 'Material Handling';
      } else if (op === 'Manufacturing') {
        return ev.category === 'Tools & Equipment';
      } else if (op === 'Distribution') {
        return ev.category === 'Vehicles' || ev.category === 'Returnable Container';
      }
      
      return true;
    });
  }

  // Chart Building Logic
  private buildCharts() {
    const stats = this.currentStats();
    const isDark = this.currentTheme() === 'dark';
    
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

    // -------------------------------------------------------------
    // Chart 1: Asset Utilization Over Time (Line)
    // -------------------------------------------------------------
    if (this.utilizationOverTimeCanvas) {
      this.charts['utilizationOverTime'] = new Chart(this.utilizationOverTimeCanvas.nativeElement, {
        type: 'line',
        data: {
          labels: ['14 May', '15 May', '16 May', '17 May', '18 May', '19 May', '20 May'],
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
                  const pct = ((val / total) * 100).toFixed(1);
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
          labels: ["Dec '24", "Jan '25", "Feb '25", "Mar '25", "Apr '25", "May '25"],
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

  protected resetReportsFilters() {
    this.reportsDateRange.set('01 May 2025 - 20 May 2025');
    this.reportsSelectedSite.set('All Sites');
    this.reportsSelectedCategory.set('All Categories');
    this.reportsSelectedDepartment.set('All Departments');
    this.reportsSelectedCustomerVendor.set('All');
    this.applyReportsFilters();
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
        ['20 May 2025, 10:14:02', 'RM-COIL-402', 'Raw Material', 'Amit Sharma', 'Check-In', 'Pune DC', 'Success'],
        ['20 May 2025, 09:42:15', 'FL-0098', 'Forklift', 'Rajesh Kumar', 'Check-Out', 'Maintenance Bay', 'Success'],
        ['20 May 2025, 08:31:50', 'TR-102', 'Trailer', 'Deepak Patil', 'Check-Out', 'Delhi NCR Route', 'Success'],
        ['19 May 2025, 17:15:33', 'PL-8890', 'Pallet Pl', 'Karan Singh', 'Check-In', 'Mumbai WH', 'Success'],
        ['19 May 2025, 16:04:12', 'TOOL-881', 'Calibration Tool', 'Vijay Nair', 'Check-Out', 'Manufacturing Line 2', 'Success']
      ];
    } else if (reportName === 'Movement History') {
      headers = ['Timestamp', 'Asset ID', 'RFID Tag EPC', 'From Zone', 'To Zone', 'Dwell Time', 'Reader Gate'];
      rows = [
        ['20 May 2025, 10:21:40', 'RM-COIL-402', 'E28011702000021A3F4B2C91', 'Staging A', 'Production Area', '45 Mins', 'Gate 4'],
        ['20 May 2025, 09:55:12', 'PL-8890', 'E28011702000021A3F4B2C92', 'Receiving Bay', 'Storage Row 12', '12 Mins', 'Gate 2'],
        ['20 May 2025, 08:14:03', 'TOOL-881', 'E28011702000021A3F4B2C93', 'Tool Room', 'Lab 1', '3 Hrs 12 Mins', 'Lab Reader'],
        ['19 May 2025, 16:48:32', 'FL-0098', 'E28011702000021A3F4B2C94', 'Zone A', 'Maintenance Area', '18 Mins', 'Maint Door'],
        ['19 May 2025, 15:30:11', 'TR-102', 'E28011702000021A3F4B2C95', 'Outbound Gate', 'Highway 4', '5 Mins', 'Main Exit']
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
        ['TOOL-401', 'Calibration Tool', 'Pune DC', 'Lab 2', '18 May 2025, 14:12:00', 'E28011702000021A3F4B2CA1', 'Admin'],
        ['PL-0023', 'Pallet Pl', 'Mumbai WH', 'Zone C', '15 May 2025, 08:31:02', 'E28011702000021A3F4B2CA2', 'System'],
        ['FL-0097', 'Forklift', 'Bengaluru Hub', 'Main Yard', '10 May 2025, 11:42:15', 'E28011702000021A3F4B2CA3', 'Supervisor'],
        ['RM-COIL-102', 'Raw Material', 'Delhi NCR', 'Buffer B', '12 May 2025, 17:33:01', 'E28011702000021A3F4B2CA4', 'System'],
        ['RFID-GATE-3', 'Handheld Reader', 'Hyderabad DC', 'Front Desk', '05 May 2025, 09:12:30', 'E28011702000021A3F4B2CA5', 'S. Kumar']
      ];
    } else if (reportName === 'Reader Performance') {
      headers = ['Reader Name', 'Location', 'Total Scans (Today)', 'Success Rate (%)', 'Uptime (%)', 'Connection Status', 'Last Activity'];
      rows = [
        ['Gate Reader 1', 'Pune DC Main Exit', '14,258', '99.8%', '100.0%', 'Online', '20 May 2025, 10:24:02'],
        ['Forklift Reader 2', 'Pune DC FL-0098', '3,452', '98.5%', '99.2%', 'Online', '20 May 2025, 10:23:45'],
        ['Dock Reader A', 'Mumbai WH Dock 4', '8,901', '99.2%', '100.0%', 'Online', '20 May 2025, 10:23:12'],
        ['Staging Reader', 'Chennai Plant Zone A', '5,671', '99.4%', '98.1%', 'Online', '20 May 2025, 10:21:00'],
        ['Yard Reader 1', 'Bengaluru Hub Yard', '12,982', '97.2%', '99.5%', 'Online', '20 May 2025, 10:24:00'],
        ['Exit Reader 2', 'Delhi NCR Gate 2', '7,890', '99.7%', '85.4%', 'Warning - High Noise', '20 May 2025, 10:23:59']
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
        ['20 May 2025, 10:24:02', 'rohit.k', 'Operations Manager', 'Export Reports PDF', '192.168.1.45', 'Success'],
        ['20 May 2025, 10:18:15', 'rohit.k', 'Operations Manager', 'Apply Report Filter: Pune DC', '192.168.1.45', 'Success'],
        ['20 May 2025, 09:44:30', 'karan.s', 'Supervisor', 'Bulk Upload Asset list', '192.168.1.92', 'Success - 124 Items'],
        ['20 May 2025, 09:12:11', 'system_cron', 'Background Service', 'Trigger Auto Backup', '127.0.0.1', 'Success'],
        ['20 May 2025, 08:30:00', 'amit.s', 'Administrator', 'Change Reader Configuration: Gate 1', '192.168.1.12', 'Success'],
        ['20 May 2025, 08:02:15', 'rohit.k', 'Operations Manager', 'User Authentication Login', '192.168.1.45', 'Success']
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
      pdf.text(`Report Generated On: 20 May 2025, 10:24 AM  |  Operator: Rohit Kumar (Operations Manager)`, 30, 110);
      
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

  private startGpsSimulation() {
    if (isPlatformBrowser(this.platformId)) {
      // Coordinate paths for moving assets (percentage coordinates on map layout)
      const forkliftPath = [
        { x: 60, y: 45 }, { x: 63, y: 50 }, { x: 67, y: 55 }, { x: 72, y: 52 },
        { x: 76, y: 48 }, { x: 70, y: 40 }, { x: 65, y: 35 }, { x: 58, y: 38 }
      ];
      let flPathIndex = 0;

      const truckPath = [
        { x: 82, y: 85 }, { x: 86, y: 88 }, { x: 92, y: 82 }, { x: 95, y: 72 },
        { x: 90, y: 62 }, { x: 84, y: 52 }, { x: 80, y: 65 }, { x: 78, y: 75 }
      ];
      let trkPathIndex = 0;

      const toolPath = [
        { x: 52, y: 52 }, { x: 54, y: 54 }, { x: 56, y: 51 }, { x: 53, y: 49 }
      ];
      let toolPathIndex = 0;

      this.gpsTimerInterval = setInterval(() => {
        if (!this.gpsAutoRefresh() || this.activeNav() !== 'GPS Tracking') return;
        this.fetchLiveGpsLocations();
      }, this.gpsRefreshInterval() * 1000);
    }
  }

  protected fetchLiveGpsLocations() {
    if (!this.isLoggedIn()) return;
    this.apiService.getVehicles().subscribe({
      next: (list: any[]) => {
        if (Array.isArray(list)) {
          this.gpsAssets.set(list.map((v: any) => {
            const x = Math.min(100, Math.max(0, Math.round(((v.lon - 73.8067) / (73.9067 - 73.8067)) * 100)));
            const y = Math.min(100, Math.max(0, Math.round(((v.lat - 18.4704) / (18.5704 - 18.4704)) * 100)));

            const currentZone = v.speed > 0 ? 'Transit Route' : 'Main Yard';
            return {
              id: v.deviceNum,
              name: v.regName || ('Vehicle ' + v.deviceNum),
              tag: 'GPS Tracker',
              type: 'Vehicle',
              status: v.status || 'Active',
              battery: Math.round(v.battery * 100),
              speed: v.speed,
              latitude: v.lat,
              longitude: v.lon,
              currentZone: currentZone,
              lastGpsPing: new Date(v.gpsTime).toLocaleTimeString(),
              lastRfidRead: '—',
              exception: 'None',
              site: 'Pune DC',
              operator: 'Operator ' + v.deviceNum.substring(v.deviceNum.length - 4),
              x,
              y,
              trail: [],
              timeline: [
                {
                  time: new Date(v.gpsTime).toLocaleTimeString(),
                  zone: currentZone,
                  details: `Live telemetry from vehicle: Speed ${v.speed}km/h, Direction ${v.direction}°`,
                  type: v.speed > 0 ? 'moving' as const : 'idle' as const
                }
              ]
            };
          }));

          if (this.gpsAssets().length > 0 && !this.gpsSelectedAsset()) {
            this.gpsSelectedAsset.set(this.gpsAssets()[0]);
          } else if (this.gpsSelectedAsset()) {
            const updatedSelected = this.gpsAssets().find(a => a.id === this.gpsSelectedAsset()?.id);
            if (updatedSelected) {
              this.gpsSelectedAsset.set(updatedSelected);
            }
          }

          const assets = this.gpsAssets();
          this.gpsTotalAssets.set(assets.length);
          this.gpsMovingCount.set(assets.filter(a => a.speed > 0).length);
          this.gpsIdleCount.set(assets.filter(a => a.speed === 0).length);
          this.gpsStoppedCount.set(assets.filter(a => a.status.includes('ACC OFF') || a.speed === 0).length);
          this.gpsLowBatteryCount.set(assets.filter(a => a.battery < 25).length);
          this.gpsExceptionCount.set(0);
          this.gpsOfflineCount.set(assets.filter(a => a.status.includes('Offline')).length);
        }
      },
      error: (err) => console.error('Failed to load GPS vehicles from PostgreSQL', err)
    });
  }

  protected selectGpsAsset(asset: GPSAsset) {
    this.gpsSelectedAsset.set(asset);
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
    this.formReaderAntennaCount = reader.antennas;
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
        this.http.put(`http://localhost:5025/api/assets/${details.id}`, payload).subscribe({
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

    const txId = (mode === 'issue' ? 'ISS-' : mode === 'return' ? 'RET-' : 'IST-') + '2025-05-0' + Math.floor(202 + Math.random() * 99);
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
    this.checkoutExpectedReturnDate.set('2025-05-27');
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
        this.http.put(`http://localhost:5025/api/assets/${asset.id}`, payload).subscribe({
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
        this.http.put(`http://localhost:5025/api/assets/${asset.id}`, payload).subscribe({
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
