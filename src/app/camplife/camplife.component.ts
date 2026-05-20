import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { NavigationCancel, NavigationEnd, NavigationError, NavigationStart, Router } from '@angular/router';
import { IonIcon, IonSpinner, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular/standalone';

import { addIcons } from 'ionicons';
import { addCircleOutline, cardOutline, settingsOutline, speedometerOutline } from 'ionicons/icons';
import { Subscription } from 'rxjs';


@Component({
  selector: 'app-camplife',
  templateUrl: './camplife.component.html',
  styleUrls: ['./camplife.component.scss'],
  imports: [IonIcon, IonSpinner, IonTabBar, IonTabButton, IonTabs],
})
export class CamplifeComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private routerEventsSubscription?: Subscription;
  protected isFinanceRouteLoading = false;

  constructor() {
    addIcons({ addCircleOutline, cardOutline, settingsOutline, speedometerOutline });
  }

  ngOnInit() {
    this.routerEventsSubscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationStart && event.url.includes('/example/finance')) {
        this.isFinanceRouteLoading = true;
        return;
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

}
