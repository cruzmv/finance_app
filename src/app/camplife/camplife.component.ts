import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { IonIcon, IonSpinner, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular/standalone';

import { addIcons } from 'ionicons';
import {
  addOutline,
  barChartOutline,
  ellipsisHorizontalOutline,
} from 'ionicons/icons';
import { Subscription } from 'rxjs';


@Component({
  selector: 'app-camplife',
  templateUrl: './camplife.component.html',
  styleUrls: ['./camplife.component.scss'],
  imports: [IonIcon, IonSpinner, IonTabBar, IonTabButton, IonTabs],
})
export class CamplifeComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly newMovementSourceStorageKey = 'newMovementSourceRoute';
  private routerEventsSubscription?: Subscription;
  private lastContentRoute = '/example/dashboard';
  protected isFinanceRouteLoading = false;

  constructor() {
    addIcons({
      addOutline,
      barChartOutline,
      ellipsisHorizontalOutline,
    });
  }

  ngOnInit() {
    this.routerEventsSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart && event.url.includes('/example/finance')) {
        this.isFinanceRouteLoading = true;
        return;
      }

      if (event instanceof NavigationEnd && !event.urlAfterRedirects.includes('/example/new')) {
        this.lastContentRoute = event.urlAfterRedirects;
      }

      if (
        event instanceof NavigationEnd ||
        event instanceof NavigationCancel ||
        event instanceof NavigationError
      ) {
        setTimeout(() => {
          this.isFinanceRouteLoading = false;
        }, 120);
      }
    });
  }

  ngOnDestroy(): void {
    this.routerEventsSubscription?.unsubscribe();
  }

  protected openNewMovement(event: Event): void {
    event.preventDefault();
    event.stopPropagation();

    const sourceRoute = this.router.url.includes('/example/new') ? this.lastContentRoute : this.router.url;
    sessionStorage.setItem(this.newMovementSourceStorageKey, sourceRoute);
    void this.router.navigate(['/example/new'], {
      state: { sourceRoute },
    });
  }

}
