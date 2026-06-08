import { HttpInterceptorFn } from '@angular/common/http';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const storedSession = localStorage.getItem('financeAuthSession');

  if (!storedSession) {
    return next(req);
  }

  try {
    const token = (JSON.parse(storedSession) as { token?: string }).token;
    return token
      ? next(req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }))
      : next(req);
  } catch {
    localStorage.removeItem('financeAuthSession');
    return next(req);
  }
};
