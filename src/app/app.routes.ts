// import { Routes } from '@angular/router';

// export const routes: Routes = [
//   {
//     path: 'home',
//     loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
//   },
//   {
//     path: '',
//     redirectTo: 'home',
//     pathMatch: 'full',
//   },
// ];





import { Routes } from '@angular/router';
import { CamplifeComponent } from './camplife/camplife.component';
import { authGuard } from './auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./login-page/login-page.component').then((m) => m.LoginPageComponent),
  },
  {
    path: 'register',
    loadComponent: () => import('./register-page/register-page.component').then((m) => m.RegisterPageComponent),
  },
  {
    path: 'example',
    component: CamplifeComponent,
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () => import('./dashboard-page/dashboard-page.component').then((m) => m.DashboardPageComponent),
      },
      {
        path: 'finance',
        loadComponent: () => import('./finance-page/finance-page.component').then((m) => m.FinancePageComponent),
      },
      {
        path: 'new',
        loadComponent: () => import('./new-page/new-page.component').then((m) => m.NewPageComponent),
      },
      {
        path: 'setup',
        loadComponent: () => import('./setup-page/setup-page.component').then((m) => m.SetupPageComponent),
      },
      {
        path: 'planning',
        loadComponent: () => import('./planning-page/planning-page.component').then((m) => m.PlanningPageComponent),
      },
      {
        path: 'reports',
        loadComponent: () => import('./reports-page/reports-page.component').then((m) => m.ReportsPageComponent),
      },
      {
        path: 'home',
        loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
      },
      {
        path: 'settings',
        loadComponent: () => import('./settings-page/settings-page.component').then((m) => m.SettingsPageComponent),
      },
      {
        path: '',
        redirectTo: '/example/dashboard',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '',
    redirectTo: '/example/dashboard',
    pathMatch: 'full',
  },
];
