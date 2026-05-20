import { Component, OnInit } from '@angular/core';
import { IonContent } from '@ionic/angular/standalone';

@Component({
  selector: 'app-settings-page',
  templateUrl: './settings-page.component.html',
  styleUrls: ['./settings-page.component.scss'],
  imports: [IonContent],
})
export class SettingsPageComponent implements OnInit {
  constructor() {}

  ngOnInit() {}
}
