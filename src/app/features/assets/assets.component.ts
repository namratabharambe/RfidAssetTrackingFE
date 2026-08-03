import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-assets',
  standalone: true,
  imports: [CommonModule],
  template: `<div class="p-6 bg-surface rounded-2xl border border-border shadow-sm"><h2 class="text-xl font-bold text-main">Assets Management</h2><p class="text-sm text-muted mt-1">Manage asset records, categories, groups, and bulk operations.</p></div>`
})
export class AssetsComponent {}
