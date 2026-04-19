import { Component, OnInit } from '@angular/core';
import { IonIcon, IonTabBar, IonTabButton, IonTabs } from '@ionic/angular/standalone';

import { addIcons } from 'ionicons';
import { card, library, radio, search, map } from 'ionicons/icons';


@Component({
  selector: 'app-camplife',
  templateUrl: './camplife.component.html',
  styleUrls: ['./camplife.component.scss'],
  imports: [IonIcon, IonTabBar, IonTabButton, IonTabs],  
})
export class CamplifeComponent  implements OnInit {

  constructor() { 
    addIcons({ card, library, map, radio, search });
  }

  ngOnInit() {}

}
