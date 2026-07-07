import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:5025/api';

  private getPagedParams(page: number, size: number, search?: string): HttpParams {
    let params = new HttpParams()
      .set('page', page.toString())
      .set('size', size.toString());
    if (search) {
      params = params.set('search', search);
    }
    return params;
  }

  // Dashboard
  getDashboardData(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/dashboard`);
  }

  // Assets
  getAssets(page = 1, size = 10, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/assets`, { params, observe: 'response' });
  }
  getAssetById(id: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/assets/${id}`);
  }
  createAsset(asset: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/assets`, asset);
  }
  updateAsset(id: string, asset: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/assets/${id}`, asset);
  }
  deleteAsset(id: string): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/assets/${id}`);
  }

  // Users
  getUsers(page = 1, size = 200, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/users`, { params, observe: 'response' });
  }
  createUser(user: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/users`, user);
  }
  updateUser(id: string, user: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/users/${id}`, user);
  }
  deleteUser(id: string): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/users/${id}`);
  }

  // Roles
  getRoles(page = 1, size = 10, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/roles`, { params, observe: 'response' });
  }
  createRole(role: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/roles`, role);
  }
  updateRole(id: string, role: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/roles/${id}`, role);
  }
  deleteRole(id: string): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/roles/${id}`);
  }

  // Permissions
  getPermissions(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/permissions`);
  }

  // Readers
  getReaders(page = 1, size = 200, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/readers`, { params, observe: 'response' });
  }
  createReader(reader: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/readers`, reader);
  }
  updateReader(id: string, reader: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/readers/${id}`, reader);
  }
  deleteReader(id: string): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/readers/${id}`);
  }

  // Handhelds
  getHandhelds(page = 1, size = 200, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/handhelds`, { params, observe: 'response' });
  }
  createHandheld(device: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/handhelds`, device);
  }
  updateHandheld(id: string, device: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/handhelds/${id}`, device);
  }
  deleteHandheld(id: string): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/handhelds/${id}`);
  }

  // RFID Tags
  getRFIDTags(page = 1, size = 200, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/rfidtags`, { params, observe: 'response' });
  }
  createRFIDTag(tag: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/rfidtags`, tag);
  }
  updateRFIDTag(id: string, tag: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/rfidtags/${id}`, tag);
  }
  deleteRFIDTag(id: string): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/rfidtags/${id}`);
  }

  // Sites/Warehouses/Zones/Locations
  getSites(page = 1, size = 10, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/sites`, { params, observe: 'response' });
  }
  getWarehouses(page = 1, size = 10, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/warehouses`, { params, observe: 'response' });
  }
  getZones(page = 1, size = 10, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/zones`, { params, observe: 'response' });
  }
  getLocations(page = 1, size = 10, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/locations`, { params, observe: 'response' });
  }

  // Assignments / Checkout Transactions
  getAssignments(page = 1, size = 200, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/assignments`, { params, observe: 'response' });
  }
  createAssignment(assignment: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/assignments`, assignment);
  }
  updateAssignment(id: string, assignment: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/assignments/${id}`, assignment);
  }

  // Transfers
  getTransfers(page = 1, size = 10, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/transfers`, { params, observe: 'response' });
  }
  createTransfer(transfer: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/transfers`, transfer);
  }

  // Audits
  getAudits(page = 1, size = 10, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/audits`, { params, observe: 'response' });
  }
  createAudit(audit: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/audits`, audit);
  }

  // Scan Events
  getScanEvents(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/scanevents`);
  }

  // GPS
  getGPSTracking(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/Gps/vehicle-android-location/16512010049`);
  }
  getGPSAndroidTracking(deviceNum: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/Gps/vehicle-android-location/${deviceNum}`);
  }
  getGPSLocation(vehicleId: string): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/Gps/vehicle-location/${vehicleId}`);
  }
  getGPSHistory(vehicleId: string, beginTime: string, endTime: string): Observable<any> {
    const params = new HttpParams()
      .set('vehicleId', vehicleId)
      .set('beginGPSTime', beginTime)
      .set('endGPSTime', endTime);
    return this.http.get<any>(`${this.baseUrl}/Gps/getTrackTablePageList`, { params });
  }

  getVehicles(): Observable<any> {
    return this.http.get<any>(`${this.baseUrl}/Gps/vehicles`);
  }

  // Alerts
  getAlerts(page = 1, size = 200, search?: string): Observable<any> {
    const params = this.getPagedParams(page, size, search);
    return this.http.get<any>(`${this.baseUrl}/alerts`, { params, observe: 'response' });
  }
  createAlert(alert: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/alerts`, alert);
  }
  updateAlert(id: string, alert: any): Observable<any> {
    return this.http.put<any>(`${this.baseUrl}/alerts/${id}`, alert);
  }
  deleteAlert(id: string): Observable<any> {
    return this.http.delete<any>(`${this.baseUrl}/alerts/${id}`);
  }

  // Reports
  downloadReport(reportType: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/reports/${reportType}`, { responseType: 'blob' });
  }
}
