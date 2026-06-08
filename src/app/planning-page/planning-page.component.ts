import { Component } from '@angular/core';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { calendarClearOutline } from 'ionicons/icons';

@Component({
  selector: 'app-planning-page',
  template: `
    <ion-content>
      <main class="planning-page">
        <ion-icon name="calendar-clear-outline"></ion-icon>
        <h1>Planejamento</h1>
        <p>Esta área será preparada na próxima etapa.</p>
      </main>
    </ion-content>
  `,
  styles: [`
    .planning-page { display: grid; min-height: 100%; place-content: center; justify-items: center; gap: 10px;
      padding: 24px; background: #f8faf9; color: #17251f; text-align: center; }
    ion-icon { color: #168454; font-size: 2.5rem; }
    h1, p { margin: 0; }
    h1 { font-size: 1.4rem; }
    p { color: #78837f; font-size: .9rem; }
  `],
  imports: [IonContent, IonIcon],
})
export class PlanningPageComponent {
  constructor() {
    addIcons({ calendarClearOutline });
  }
}
