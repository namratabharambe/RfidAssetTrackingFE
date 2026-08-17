import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap, catchError } from 'rxjs/operators';
import { Observable, throwError } from 'rxjs';

import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiUrl}/auth`;

  readonly token = signal<string | null>(localStorage.getItem('jwt_token'));
  readonly refreshToken = signal<string | null>(localStorage.getItem('refresh_token'));
  readonly currentUser = signal<any | null>(JSON.parse(localStorage.getItem('current_user') || 'null'));
  
  readonly isSessionExpired = signal<boolean>(false);
  readonly sessionExpiredReason = signal<string>('Your session has expired. Please log in again to continue.');
  readonly isLoggedIn = signal<boolean>(!!this.token() && !this.isTokenExpired(this.token()));

  readonly initialAllowedSites = signal<any[]>(JSON.parse(localStorage.getItem('initial_allowed_sites') || '[]'));
  readonly initialAllowedWarehouses = signal<any[]>(JSON.parse(localStorage.getItem('initial_allowed_warehouses') || '[]'));

  constructor() {
    const currentToken = this.token();
    if (currentToken && this.isTokenExpired(currentToken)) {
      this.handleSessionExpired('Your token has expired. Please log in again.');
    }
  }

  isTokenExpired(token: string | null): boolean {
    if (!token) return true;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return true;
      const payloadBase64 = parts[1];
      const decodedJson = atob(payloadBase64.replace(/-/g, '+').replace(/_/g, '/'));
      const payload = JSON.parse(decodedJson);
      if (!payload.exp) return false;
      const currentTime = Math.floor(Date.now() / 1000);
      return payload.exp < currentTime;
    } catch {
      return true;
    }
  }

  handleSessionExpired(reason?: string) {
    this.clearStorage();
    if (reason) {
      this.sessionExpiredReason.set(reason);
    } else {
      this.sessionExpiredReason.set('Your session has expired. Please log in again to continue.');
    }
    this.isSessionExpired.set(true);
  }

  closeSessionExpiredModal() {
    this.isSessionExpired.set(false);
  }

  login(credentials: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/login`, credentials).pipe(
      tap(res => {
        localStorage.setItem('jwt_token', res.token);
        localStorage.setItem('refresh_token', res.refreshToken);
        localStorage.setItem('current_user', JSON.stringify(res.user));
        if (res.user?.allowedSites && Array.isArray(res.user.allowedSites)) {
          localStorage.setItem('initial_allowed_sites', JSON.stringify(res.user.allowedSites));
          this.initialAllowedSites.set(res.user.allowedSites);
        }
        if (res.user?.allowedWarehouses && Array.isArray(res.user.allowedWarehouses)) {
          localStorage.setItem('initial_allowed_warehouses', JSON.stringify(res.user.allowedWarehouses));
          this.initialAllowedWarehouses.set(res.user.allowedWarehouses);
        }
        
        this.token.set(res.token);
        this.refreshToken.set(res.refreshToken);
        this.currentUser.set(res.user);
        this.isLoggedIn.set(true);
        this.isSessionExpired.set(false);
      })
    );
  }

  logout(): Observable<any> {
    const payload = { refreshToken: this.refreshToken() };
    return this.http.post<any>(`${this.baseUrl}/logout`, payload).pipe(
      tap(() => this.clearStorage()),
      catchError(err => {
        this.clearStorage();
        return throwError(() => err);
      })
    );
  }

  refresh(): Observable<any> {
    const payload = { token: this.token(), refreshToken: this.refreshToken() };
    return this.http.post<any>(`${this.baseUrl}/refresh`, payload).pipe(
      tap(res => {
        localStorage.setItem('jwt_token', res.token);
        localStorage.setItem('refresh_token', res.refreshToken);
        localStorage.setItem('current_user', JSON.stringify(res.user));
        
        this.token.set(res.token);
        this.refreshToken.set(res.refreshToken);
        this.currentUser.set(res.user);
        this.isLoggedIn.set(true);
        this.isSessionExpired.set(false);
      })
    );
  }

  switchContext(siteId?: string, warehouseId?: string): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/switch-context`, { siteId, warehouseId }).pipe(
      tap(res => {
        if (res.token) {
          localStorage.setItem('jwt_token', res.token);
          this.token.set(res.token);
        }
        if (res.refreshToken) {
          localStorage.setItem('refresh_token', res.refreshToken);
          this.refreshToken.set(res.refreshToken);
        }
        if (res.user) {
          const existingUser = this.currentUser();
          const initialSites = this.initialAllowedSites();
          const initialWhs = this.initialAllowedWarehouses();

          const preservedSites = (initialSites && initialSites.length > 0)
            ? initialSites
            : ((existingUser?.allowedSites && existingUser.allowedSites.length > 1) ? existingUser.allowedSites : res.user.allowedSites);

          const preservedWarehouses = (initialWhs && initialWhs.length > 0)
            ? initialWhs
            : ((existingUser?.allowedWarehouses && existingUser.allowedWarehouses.length > 1) ? existingUser.allowedWarehouses : res.user.allowedWarehouses);

          const updatedUser = {
            ...res.user,
            allowedSites: preservedSites,
            allowedWarehouses: preservedWarehouses
          };

          localStorage.setItem('current_user', JSON.stringify(updatedUser));
          this.currentUser.set(updatedUser);
        }
      })
    );
  }

  clearStorage() {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('current_user');
    localStorage.removeItem('initial_allowed_sites');
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('activeNav');
    localStorage.removeItem('activeSubNav');
    localStorage.removeItem('selected_site_name');
    localStorage.removeItem('selected_site_id');
    
    this.token.set(null);
    this.refreshToken.set(null);
    this.initialAllowedSites.set([]);
    this.currentUser.set(null);
    this.isLoggedIn.set(false);
  }

}
