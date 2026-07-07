import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { tap, catchError } from 'rxjs/operators';
import { Observable, throwError } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = 'http://localhost:5025/api/auth';

  readonly token = signal<string | null>(localStorage.getItem('jwt_token'));
  readonly refreshToken = signal<string | null>(localStorage.getItem('refresh_token'));
  readonly currentUser = signal<any | null>(JSON.parse(localStorage.getItem('current_user') || 'null'));
  readonly isLoggedIn = signal<boolean>(!!this.token());

  login(credentials: any): Observable<any> {
    return this.http.post<any>(`${this.baseUrl}/login`, credentials).pipe(
      tap(res => {
        localStorage.setItem('jwt_token', res.token);
        localStorage.setItem('refresh_token', res.refreshToken);
        localStorage.setItem('current_user', JSON.stringify(res.user));
        
        this.token.set(res.token);
        this.refreshToken.set(res.refreshToken);
        this.currentUser.set(res.user);
        this.isLoggedIn.set(true);
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
      })
    );
  }

  clearStorage() {
    localStorage.removeItem('jwt_token');
    localStorage.removeItem('refresh_token');
    localStorage.removeItem('current_user');
    
    this.token.set(null);
    this.refreshToken.set(null);
    this.currentUser.set(null);
    this.isLoggedIn.set(false);
  }
}
