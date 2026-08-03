import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-admin',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="p-6 bg-surface rounded-2xl border border-border shadow-sm"><h2 class="text-xl font-bold text-main">Administration</h2><p class="text-sm text-muted mt-1">User access controls, system settings, and reader profile configurations.</p></div>`
})
export class AdminComponent {}
