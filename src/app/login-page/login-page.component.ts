import { CommonModule } from '@angular/common';
import { Component, ElementRef, OnInit, ViewChild, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { eyeOffOutline, eyeOutline, lockClosedOutline, walletOutline } from 'ionicons/icons';
import { finalize } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from '../auth.service';

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string;
        callback: (response: GoogleCredentialResponse) => void;
      }) => void;
      renderButton: (element: HTMLElement, options: Record<string, string>) => void;
    };
  };
}

@Component({
  selector: 'app-login-page',
  templateUrl: './login-page.component.html',
  styleUrls: ['./login-page.component.scss'],
  imports: [CommonModule, IonContent, IonIcon, ReactiveFormsModule, RouterLink],
})
export class LoginPageComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly googleClientId = environment.googleClientId;
  @ViewChild('googleButton') private googleButton?: ElementRef<HTMLElement>;

  protected readonly signInForm = this.fb.nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });
  protected isSigningIn = false;
  protected isPasswordVisible = false;
  protected errorMessage = '';
  protected readonly isGoogleConfigured = !!this.googleClientId;

  constructor() {
    addIcons({ eyeOffOutline, eyeOutline, lockClosedOutline, walletOutline });
  }

  ngOnInit(): void {
    if (this.auth.isAuthenticated) {
      void this.router.navigate(['/example/dashboard']);
      return;
    }

    if (this.isGoogleConfigured) {
      this.loadGoogleSignIn();
    }
  }

  protected signIn(): void {
    this.signInForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.signInForm.invalid) {
      this.errorMessage = 'Preencha o utilizador e a palavra-passe.';
      return;
    }

    const { username, password } = this.signInForm.getRawValue();
    this.isSigningIn = true;
    this.auth
      .signIn(username.trim(), password)
      .pipe(finalize(() => (this.isSigningIn = false)))
      .subscribe({
        next: () => void this.router.navigate(['/example/dashboard']),
        error: () => {
          this.errorMessage = 'Utilizador ou palavra-passe inválidos.';
        },
      });
  }

  protected togglePasswordVisibility(): void {
    this.isPasswordVisible = !this.isPasswordVisible;
  }

  private loadGoogleSignIn(): void {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-identity]');

    if (existingScript) {
      this.renderGoogleButton();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset['googleIdentity'] = 'true';
    script.onload = () => this.renderGoogleButton();
    document.head.appendChild(script);
  }

  private renderGoogleButton(): void {
    const google = (window as unknown as { google?: GoogleIdentity }).google;
    const button = this.googleButton?.nativeElement;

    if (!google || !button) {
      setTimeout(() => this.renderGoogleButton(), 0);
      return;
    }

    google.accounts.id.initialize({
      client_id: this.googleClientId,
      callback: ({ credential }) => this.handleGoogleCredential(credential),
    });
    google.accounts.id.renderButton(button, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'signin_with',
      shape: 'pill',
      width: '280',
    });
  }

  private handleGoogleCredential(credential: string): void {
    this.isSigningIn = true;
    this.errorMessage = '';
    this.auth
      .signInWithGoogle(credential)
      .pipe(finalize(() => (this.isSigningIn = false)))
      .subscribe({
        next: () => void this.router.navigate(['/example/dashboard']),
        error: () => {
          this.errorMessage = 'Não foi possível entrar com esta conta Google.';
        },
      });
  }
}
