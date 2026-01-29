import { test, expect } from '@playwright/test';

test.describe('Screenshot Crawl - Full Frontend Tour', () => {
  let screenshotCount = 0;
  const screenshotDir = 'screenshots';

  // Helper function to take timestamped screenshots
  const takeScreenshot = async (page: any, name: string) => {
    screenshotCount++;
    const filename = `${String(screenshotCount).padStart(3, '0')}-${name}.png`;
    await page.screenshot({ path: `${screenshotDir}/${filename}`, fullPage: true });
    console.log(`✓ Screenshot ${screenshotCount}: ${filename}`);
  };

  // Helper to navigate and wait for load
  const navigateTo = async (page: any, path: string) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
  };

  // Helper to click a tab and capture screenshot
  const clickTabAndCapture = async (
    page: any,
    tabSelector: string,
    screenshotName: string
  ) => {
    const tab = page.locator(tabSelector).first();
    const isVisible = await tab.isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      await tab.click();
      await page.waitForLoadState('networkidle');
      await takeScreenshot(page, screenshotName);
      return true;
    }
    return false;
  };

  test('Comprehensive frontend crawl with all pages and tabs', async ({ page }) => {

    // 1. Login page
    console.log('\n📸 === LOGIN & AUTHENTICATION ===');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '01-login-page');

    // 2. Login as admin
    console.log('🔐 Logging in as admin...');
    const emailInput = page.locator('input[id="email"]');
    const passwordInput = page.locator('input[id="password"]');

    await emailInput.fill('admin@example.com');
    await passwordInput.fill('admin123');

    const signInButton = page.locator('button:has-text("Sign in")').first();
    await signInButton.click({ timeout: 10000 });

    await page.waitForURL(/\/(servers|dashboard)/, { timeout: 15000 }).catch(() => {
      console.log('Redirect check timed out, continuing anyway');
    });
    await page.waitForLoadState('networkidle');

    // 3. Dashboard/Home page
    console.log('\n📸 === DASHBOARD ===');
    // Attempt to navigate to dashboard if not already there
    await page.goto('/dashboard').catch(() => {
      console.log('Dashboard not found, staying on current page');
    });
    await page.waitForLoadState('networkidle');
    await takeScreenshot(page, '02-dashboard-home');

    // 4. SERVERS SECTION
    console.log('\n📸 === SERVERS SECTION ===');
    await navigateTo(page, '/servers');
    await takeScreenshot(page, '03-servers-list-page');

    // Get all servers from the list (if any exist)
    const serverCount = await page.locator('a[href*="/servers/"]').count();
    console.log(`Found ${serverCount} servers`);

    if (serverCount > 0) {
      // Visit first server details
      const firstServer = page.locator('a[href*="/servers/"]').first();
      const serverId = await firstServer.getAttribute('href');
      console.log(`Visiting first server: ${serverId}`);

      await firstServer.click();
      await page.waitForLoadState('networkidle');
      await takeScreenshot(page, '04-server-details-overview');

      // Capture all tabs on server details
      const tabs = [
        { selector: 'button:has-text("Details")', name: 'server-details-tab' },
        { selector: 'button:has-text("Console")', name: 'server-console-tab' },
        { selector: 'button:has-text("Files")', name: 'server-files-tab' },
        { selector: 'button:has-text("Settings")', name: 'server-settings-tab' },
        { selector: 'button:has-text("Backups")', name: 'server-backups-tab' },
        { selector: 'button:has-text("Tasks")', name: 'server-tasks-tab' },
        { selector: 'button:has-text("Logs")', name: 'server-logs-tab' },
        { selector: 'button:has-text("Stats")', name: 'server-stats-tab' },
      ];

      let tabCount = 5;
      for (const tab of tabs) {
        const found = await clickTabAndCapture(page, tab.selector, `0${tabCount}-${tab.name}`);
        if (found) {
          tabCount++;
        }
      }

      // Go back to servers list
      await page.goBack();
      await page.waitForLoadState('networkidle');

      // Visit second server if available
      const secondServerCount = await page.locator('a[href*="/servers/"]').count();
      if (secondServerCount > 1) {
        console.log('Visiting second server');
        const secondServer = page.locator('a[href*="/servers/"]').nth(1);
        await secondServer.click();
        await page.waitForLoadState('networkidle');
        await takeScreenshot(page, `13-server-details-overview-2`);

        await page.goBack();
        await page.waitForLoadState('networkidle');
      }
    }

    // 5. NODES SECTION
    console.log('\n📸 === NODES SECTION ===');
    await navigateTo(page, '/nodes');
    await takeScreenshot(page, '14-nodes-list-page');

    const nodeCount = await page.locator('a[href*="/nodes/"]').count();
    console.log(`Found ${nodeCount} nodes`);

    if (nodeCount > 0) {
      // Visit first node details
      const firstNode = page.locator('a[href*="/nodes/"]').first();
      await firstNode.click();
      await page.waitForLoadState('networkidle');
      await takeScreenshot(page, '15-node-details-overview');

      // Capture node tabs
      const nodeTabs = [
        { selector: 'button:has-text("Details")', name: 'node-details-tab' },
        { selector: 'button:has-text("Metrics")', name: 'node-metrics-tab' },
        { selector: 'button:has-text("Resources")', name: 'node-resources-tab' },
        { selector: 'button:has-text("Settings")', name: 'node-settings-tab' },
      ];

      let nodeTabCount = 16;
      for (const tab of nodeTabs) {
        const found = await clickTabAndCapture(page, tab.selector, `${nodeTabCount}-${tab.name}`);
        if (found) {
          nodeTabCount++;
        }
      }

      await page.goBack();
      await page.waitForLoadState('networkidle');
    }

    // 6. TEMPLATES SECTION
    console.log('\n📸 === TEMPLATES SECTION ===');
    await navigateTo(page, '/templates');
    await takeScreenshot(page, `20-templates-list-page`);

    const templateCount = await page.locator('a[href*="/templates/"]').count();
    console.log(`Found ${templateCount} templates`);

    if (templateCount > 0) {
      // Visit first template
      const firstTemplate = page.locator('a[href*="/templates/"]').first();
      await firstTemplate.click();
      await page.waitForLoadState('networkidle');
      await takeScreenshot(page, '21-template-details-overview');

      // Capture template tabs
      const templateTabs = [
        { selector: 'button:has-text("Details")', name: 'template-details-tab' },
        { selector: 'button:has-text("Variables")', name: 'template-variables-tab' },
        { selector: 'button:has-text("Settings")', name: 'template-settings-tab' },
      ];

      let templateTabCount = 22;
      for (const tab of templateTabs) {
        const found = await clickTabAndCapture(page, tab.selector, `${templateTabCount}-${tab.name}`);
        if (found) {
          templateTabCount++;
        }
      }

      await page.goBack();
      await page.waitForLoadState('networkidle');
    }

    // 7. TASKS SECTION
    console.log('\n📸 === TASKS SECTION ===');
    await navigateTo(page, '/tasks');
    await takeScreenshot(page, '25-tasks-list-page');

    // Try to expand/click tasks if available
    const taskCount = await page.locator('button, a').filter({ hasText: /task/i }).count();
    if (taskCount > 0) {
      await clickTabAndCapture(page, 'button:has-text("Active")', '26-tasks-active-tab');
      await clickTabAndCapture(page, 'button:has-text("Completed")', '27-tasks-completed-tab');
    }

    // 8. ALERTS SECTION
    console.log('\n📸 === ALERTS SECTION ===');
    await navigateTo(page, '/admin/alerts');
    await takeScreenshot(page, '28-alerts-list-page');

    // Capture alert tabs if they exist
    await clickTabAndCapture(page, 'button:has-text("Active")', '29-alerts-active-tab');
    await clickTabAndCapture(page, 'button:has-text("History")', '30-alerts-history-tab');

    // 9. ADMIN SECTION
    console.log('\n📸 === ADMIN SECTION ===');

    // Try to navigate directly to admin pages
    const adminPages = [
      { url: '/admin/users', screenshot: '31-admin-users-page' },
      { url: '/admin/servers', screenshot: '32-admin-servers-page' },
      { url: '/admin/templates', screenshot: '33-admin-templates-page' },
      { url: '/admin/nodes', screenshot: '34-admin-nodes-page' },
      { url: '/admin/audit-logs', screenshot: '35-admin-audit-logs-page' },
      { url: '/admin/system', screenshot: '36-admin-system-page' },
      { url: '/admin/settings', screenshot: '37-admin-settings-page' },
    ];

    for (const adminPage of adminPages) {
      try {
        await navigateTo(page, adminPage.url);
        await takeScreenshot(page, adminPage.screenshot);
      } catch (e) {
        console.log(`Admin page ${adminPage.url} not found, skipping...`);
      }
    }

    // 10. Try to find and click navigation items for more comprehensive coverage
    console.log('\n📸 === ADDITIONAL NAVIGATION ===');

    // Try to capture user menu/account page
    try {
      await navigateTo(page, '/account');
      await takeScreenshot(page, '38-user-account-page');
    } catch (e) {
      console.log('Account page not found');
    }

    // 11. Summary
    console.log('\n✅ Screenshot crawl complete!');
    console.log(`📊 Total screenshots captured: ${screenshotCount}`);
    console.log(`📁 Screenshots saved to: ${screenshotDir}/`);
    console.log(`🖥️  Resolution: 1920x1080 (1080P)`);
  });

  test('Responsive design validation at multiple resolutions', async ({ page }) => {
    // Login first
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const emailInput = page.locator('input[id="email"]');
    const passwordInput = page.locator('input[id="password"]');

    await emailInput.fill('admin@example.com');
    await passwordInput.fill('admin123');

    const signInButton = page.locator('button:has-text("Sign in")').first();
    await signInButton.click({ timeout: 10000 });

    await page.waitForURL(/\/(servers|dashboard)/, { timeout: 15000 }).catch(() => {
      console.log('Redirect check timed out, continuing');
    });
    await page.waitForLoadState('networkidle');

    console.log('\n📱 === RESPONSIVE DESIGN TESTING ===');

    // Test different resolutions
    const resolutions = [
      { width: 1920, height: 1080, name: 'desktop-1080p', label: '2K Desktop' },
      { width: 1280, height: 720, name: 'desktop-720p', label: 'HD Desktop' },
      { width: 1024, height: 768, name: 'tablet-landscape', label: 'Tablet Landscape' },
      { width: 768, height: 1024, name: 'tablet-portrait', label: 'Tablet Portrait' },
      { width: 428, height: 926, name: 'mobile-iphone', label: 'Mobile (iPhone)' },
      { width: 375, height: 812, name: 'mobile-iphone-se', label: 'Mobile (iPhone SE)' },
    ];

    let resCount = 39;
    for (const res of resolutions) {
      console.log(`\n📏 Testing ${res.label} (${res.width}x${res.height})`);
      await page.setViewportSize({ width: res.width, height: res.height });
      await page.waitForLoadState('networkidle');

      // Screenshot dashboard
      const filename = `${String(resCount).padStart(3, '0')}-responsive-dashboard-${res.name}.png`;
      await page.screenshot({
        path: `${screenshotDir}/${filename}`,
        fullPage: true,
      });
      console.log(`✓ Screenshot ${resCount}: ${filename}`);
      resCount++;

      // Screenshot servers list at this resolution
      await navigateTo(page, '/servers');
      const serverFilename = `${String(resCount).padStart(3, '0')}-responsive-servers-${res.name}.png`;
      await page.screenshot({
        path: `${screenshotDir}/${serverFilename}`,
        fullPage: true,
      });
      console.log(`✓ Screenshot ${resCount}: ${serverFilename}`);
      resCount++;
    }

    console.log('\n✅ Responsive design testing complete!');
    console.log(`📊 Total screenshots in this test: ${resCount - 39}`);
  });

  test('Deep dive: Server management workflows', async ({ page }) => {
    // Login
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const emailInput = page.locator('input[id="email"]');
    const passwordInput = page.locator('input[id="password"]');

    await emailInput.fill('admin@example.com');
    await passwordInput.fill('admin123');

    const signInButton = page.locator('button:has-text("Sign in")').first();
    await signInButton.click({ timeout: 10000 });

    await page.waitForURL(/\/(servers|dashboard)/, { timeout: 15000 }).catch(() => {
      console.log('Redirect check timed out, continuing');
    });
    await page.waitForLoadState('networkidle');

    console.log('\n🎮 === SERVER MANAGEMENT WORKFLOWS ===');

    // Navigate to servers
    await navigateTo(page, '/servers');

    // Take general servers overview screenshot
    let workflowCount = 57;
    let filename = `${String(workflowCount).padStart(3, '0')}-workflow-servers-overview.png`;
    await page.screenshot({ path: `${screenshotDir}/${filename}`, fullPage: true });
    console.log(`✓ Screenshot ${workflowCount}: ${filename}`);
    workflowCount++;

    // Check if any servers exist and interact with them
    const serverCount = await page.locator('a[href*="/servers/"]').count();
    if (serverCount > 0) {
      // Get all servers and visit each one
      const serverLinks = page.locator('a[href*="/servers/"]');
      const count = await serverLinks.count();
      console.log(`\nFound ${count} servers, capturing each one...`);

      for (let i = 0; i < Math.min(count, 3); i++) {
        // Click server
        const servers = page.locator('a[href*="/servers/"]');
        await servers.nth(i).click();
        await page.waitForLoadState('networkidle');

        filename = `${String(workflowCount).padStart(3, '0')}-workflow-server-${i + 1}-overview.png`;
        await page.screenshot({ path: `${screenshotDir}/${filename}`, fullPage: true });
        console.log(`✓ Screenshot ${workflowCount}: ${filename}`);
        workflowCount++;

        // Click Console tab
        const consoleTab = page.locator('button:has-text("Console")').first();
        if (await consoleTab.isVisible({ timeout: 3000 }).catch(() => false)) {
          await consoleTab.click();
          await page.waitForLoadState('networkidle');

          filename = `${String(workflowCount).padStart(3, '0')}-workflow-server-${i + 1}-console.png`;
          await page.screenshot({ path: `${screenshotDir}/${filename}`, fullPage: true });
          console.log(`✓ Screenshot ${workflowCount}: ${filename}`);
          workflowCount++;
        }

        // Click Files tab
        const filesTab = page.locator('button:has-text("Files")').first();
        if (await filesTab.isVisible({ timeout: 3000 }).catch(() => false)) {
          await filesTab.click();
          await page.waitForLoadState('networkidle');

          filename = `${String(workflowCount).padStart(3, '0')}-workflow-server-${i + 1}-files.png`;
          await page.screenshot({ path: `${screenshotDir}/${filename}`, fullPage: true });
          console.log(`✓ Screenshot ${workflowCount}: ${filename}`);
          workflowCount++;
        }

        // Go back to servers list
        await page.goBack();
        await page.waitForLoadState('networkidle');
      }
    }

    console.log('\n✅ Server management workflow testing complete!');
    console.log(`📊 Total screenshots in this test: ${workflowCount - 57}`);
  });
});
