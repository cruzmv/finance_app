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
        path: 'home',
        loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
        
      },
      {
        path: 'library',
        loadComponent: () => import('./library-page/library-page.component').then((m) => m.LibraryPageComponent),
      },
      {
        path: 'finance',
        loadComponent: () => import('./finance-page/finance-page.component').then((m) => m.FinancePageComponent),
      },
      {
        path: 'radio',
        loadComponent: () => import('./radio-page/radio-page.component').then((m) => m.RadioPageComponent),
      },
      {
        path: 'search',
        loadComponent: () => import('./search-page/search-page.component').then((m) => m.SearchPageComponent),
      },
      {
        path: '',
        redirectTo: '/example/home',
        pathMatch: 'full',
      },
    ],
  },
  {
    path: '',
    redirectTo: '/example/home',
    pathMatch: 'full',
  },
];
