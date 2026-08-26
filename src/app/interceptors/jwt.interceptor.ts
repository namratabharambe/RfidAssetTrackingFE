import { inject } from '@angular/core';
import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../services/auth.service';
import { catchError, switchMap } from 'rxjs/operators';
import { throwError } from 'rxjs';

export const jwtInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.token();

  if (token && authService.isTokenExpired(token)) {
    if (authService.refreshToken()) {
      return authService.refresh().pipe(
        switchMap(() => {
          const newToken = authService.token();
          const headers: Record<string, string> = {
            Authorization: `Bearer ${newToken}`
          };
          const ctx = authService.currentTokenContext();
          if (ctx?.siteId) headers['X-Site-Id'] = ctx.siteId;
          if (ctx?.warehouseId) headers['X-Warehouse-Id'] = ctx.warehouseId;
          if (ctx?.role) headers['X-Role'] = ctx.role;

          const authReq = req.clone({ setHeaders: headers });
          return next(authReq);
        }),
        catchError((err) => {
          authService.handleSessionExpired('Session Expired: Your session has expired. Please log in again.');
          return throwError(() => err);
        })
      );
    } else {
      authService.handleSessionExpired('Session Expired: Your session has expired. Please log in again.');
      return throwError(() => new Error('Token expired'));
    }
  }

  let authReq = req;
  if (token) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`
    };
    const ctx = authService.currentTokenContext();
    if (ctx?.siteId) headers['X-Site-Id'] = ctx.siteId;
    if (ctx?.warehouseId) headers['X-Warehouse-Id'] = ctx.warehouseId;
    if (ctx?.role) headers['X-Role'] = ctx.role;

    authReq = req.clone({ setHeaders: headers });
  }

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      if (error.status === 401 && authService.isLoggedIn()) {
        return authService.refresh().pipe(
          switchMap(() => {
            const newToken = authService.token();
            const headers: Record<string, string> = {
              Authorization: `Bearer ${newToken}`
            };
            const ctx = authService.currentTokenContext();
            if (ctx?.siteId) headers['X-Site-Id'] = ctx.siteId;
            if (ctx?.warehouseId) headers['X-Warehouse-Id'] = ctx.warehouseId;
            if (ctx?.role) headers['X-Role'] = ctx.role;

            const retryReq = req.clone({ setHeaders: headers });
            return next(retryReq);
          }),
          catchError((refreshErr) => {
            authService.handleSessionExpired('Session Expired: Your session has expired. Please log in again.');
            return throwError(() => refreshErr);
          })
        );
      }
      return throwError(() => error);
    })
  );
};
