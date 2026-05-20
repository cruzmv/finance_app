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

export const routes: Routes = [
  {
    path: 'example',
    component: CamplifeComponent,
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
