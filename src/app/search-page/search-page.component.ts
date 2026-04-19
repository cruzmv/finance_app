import { Component, OnInit } from '@angular/core';
import { IonContent, IonHeader, IonTitle, IonToolbar } from '@ionic/angular/standalone';

@Component({
  selector: 'app-search-page',
  templateUrl: './search-page.component.html',
  styleUrls: ['./search-page.component.scss'],
  imports: [IonContent],  // , IonHeader, IonTitle, IonToolbar
})
export class SearchPageComponent  implements OnInit {

  constructor() { }

  ngOnInit() {}

}
