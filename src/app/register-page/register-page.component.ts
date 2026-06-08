import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { eyeOffOutline, eyeOutline, personAddOutline, walletOutline } from 'ionicons/icons';
import { finalize } from 'rxjs';
import { AuthService } from '../auth.service';

@Component({
  selector: 'app-register-page',
  templateUrl: './register-page.component.html',
  styleUrls: ['./register-page.component.scss'],
  imports: [IonContent, IonIcon, ReactiveFormsModule, RouterLink],
})
export class RegisterPageComponent {
  private readonly auth = inject(AuthService);
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);

  protected readonly registerForm = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    username: ['', Validators.required],
    password: ['', [Validators.required, Validators.minLength(8)]],
    joinCode: [''],
  });
  protected isRegistering = false;
  protected isPasswordVisible = false;
  protected errorMessage = '';

  constructor() {
    addIcons({ eyeOffOutline, eyeOutline, personAddOutline, walletOutline });
  }

  protected register(): void {
    this.registerForm.markAllAsTouched();
    this.errorMessage = '';

    if (this.registerForm.invalid) {
      this.errorMessage = 'Preencha email, utilizador e uma palavra-passe com pelo menos 8 caracteres.';
      return;
    }

    const { email, username, password, joinCode } = this.registerForm.getRawValue();
    this.isRegistering = true;
    this.auth
      .register(email.trim(), username.trim(), password, joinCode.trim())
      .pipe(finalize(() => (this.isRegistering = false)))
      .subscribe({
        next: () => void this.router.navigate(['/example/dashboard']),
        error: (error) => {
          this.errorMessage = error.error?.message ?? 'Não foi possível criar a conta.';
        },
      });
  }

  protected togglePasswordVisibility(): void {
    this.isPasswordVisible = !this.isPasswordVisible;
  }
}
