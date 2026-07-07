import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isLoggedIn()) {
    const requiredPermission = route.data?.['permission'] as string;
    if (requiredPermission) {
      const user = authService.currentUser();
      const permissions = user?.permissions || [];
      if (!permissions.includes(requiredPermission)) {
        router.navigate(['/']);
        return false;
      }
    }
    return true;
  }

  router.navigate(['/login']);
  return false;
};
