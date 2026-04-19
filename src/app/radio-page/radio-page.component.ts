import { Component, OnInit } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';

@Component({
  selector: 'app-radio-page',
  templateUrl: './radio-page.component.html',
  styleUrls: ['./radio-page.component.scss'],
  imports: [IonContent],   // , IonHeader, IonTitle, IonToolbar

})
export class RadioPageComponent  implements OnInit {

  constructor() { }

  ngOnInit() {}

}
