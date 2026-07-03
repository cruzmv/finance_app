import { HttpEvent, HttpInterceptorFn } from '@angular/common/http';
import { MonoTypeOperatorFunction, catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const storedSession = localStorage.getItem('financeAuthSession');

  if (!storedSession) {
    return next(req).pipe(catchUnauthorizedResponse);
  }

  try {
    const token = (JSON.parse(storedSession) as { token?: string }).token;
    return token
      ? next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } })).pipe(catchUnauthorizedResponse)
      : next(req).pipe(catchUnauthorizedResponse);
  } catch {
    localStorage.removeItem('financeAuthSession');
    return next(req).pipe(catchUnauthorizedResponse);
  }
};

const catchUnauthorizedResponse: MonoTypeOperatorFunction<HttpEvent<unknown>> = catchError((error) => {
  if (error?.status === 401) {
    localStorage.removeItem('financeAuthSession');

    if (!window.location.pathname.includes('/login')) {
      window.location.assign('/login');
    }
  }

  return throwError(() => error);
});
