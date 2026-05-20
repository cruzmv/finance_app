import { Component, OnInit } from '@angular/core';
import { IonIcon, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular/standalone';

import { addIcons } from 'ionicons';
import { addCircleOutline, cardOutline, settingsOutline, speedometerOutline } from 'ionicons/icons';


@Component({
  selector: 'app-camplife',
  templateUrl: './camplife.component.html',
  styleUrls: ['./camplife.component.scss'],
  imports: [IonIcon, IonTabBar, IonTabButton, IonTabs],  
})
export class CamplifeComponent  implements OnInit {

  constructor() { 
    addIcons({ addCircleOutline, cardOutline, settingsOutline, speedometerOutline });
  }

  ngOnInit() {}

}
