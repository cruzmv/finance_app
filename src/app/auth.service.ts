import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../environments/environment';

export interface AuthUser {
  userId: number;
  contractId: number;
  username: string;
}

interface AuthSession {
  token: string;
  user: AuthUser;
}

interface AuthResponse {
  data: AuthSession;
}

interface ContractResponse {
  data: {
    joinCode: string;
  };
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly apiBaseUrl = environment.apiBaseUrl;
  private readonly sessionStorageKey = 'financeAuthSession';

  get token(): string {
    return this.getSession()?.token ?? '';
  }

  get user(): AuthUser | null {
    return this.getSession()?.user ?? null;
  }

  get isAuthenticated(): boolean {
    return !!this.token;
  }

  signIn(username: string, password: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiBaseUrl}/auth/login`, { username, password })
      .pipe(tap(({ data }) => this.storeSession(data)));
  }

  register(email: string, username: string, password: string, joinCode: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiBaseUrl}/auth/register`, { email, username, password, joinCode })
      .pipe(tap(({ data }) => this.storeSession(data)));
  }

  signInWithGoogle(credential: string): Observable<AuthResponse> {
    return this.http
      .post<AuthResponse>(`${this.apiBaseUrl}/auth/google`, { credential })
      .pipe(tap(({ data }) => this.storeSession(data)));
  }

  getContractJoinCode(): Observable<ContractResponse> {
    return this.http.get<ContractResponse>(`${this.apiBaseUrl}/auth/contract`);
  }

  logout(): void {
    localStorage.removeItem(this.sessionStorageKey);
    void this.router.navigate(['/login']);
  }

  private storeSession(session: AuthSession): void {
    localStorage.setItem(this.sessionStorageKey, JSON.stringify(session));
  }

  private getSession(): AuthSession | null {
    const value = localStorage.getItem(this.sessionStorageKey);

    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as AuthSession;
    } catch {
      localStorage.removeItem(this.sessionStorageKey);
      return null;
    }
  }
}
