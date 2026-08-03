import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="p-6 bg-surface rounded-2xl border border-border shadow-sm"><h2 class="text-xl font-bold text-main">Check in / Check out</h2><p class="text-sm text-muted mt-1">Issue assets, return items, and track custodian assignments.</p></div>`
})
export class CheckoutComponent {}
