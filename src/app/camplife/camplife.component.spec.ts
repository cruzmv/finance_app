import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CamplifeComponent } from './camplife.component';

describe('CamplifeComponent', () => {
  let component: CamplifeComponent;
  let fixture: ComponentFixture<CamplifeComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CamplifeComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(CamplifeComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
