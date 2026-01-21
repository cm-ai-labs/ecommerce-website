/**
 * Page Authentication Module
 * Include this script on all protected pages to:
 * - Require authentication (redirect to login if not authenticated)
 * - Update user display in sidebar
 * - Add logout functionality
 * - Add admin link if user is admin
 * - Track page views for notification system
 */

import { requireAuth, logout, getCurrentUserData, auth } from './auth.js';
import { db } from './firebase-config.js';
import {
    collection,
    doc,
    getDoc,
    setDoc,
    getDocs,
    updateDoc,
    query,
    where,
    serverTimestamp,
    Timestamp
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js';
import {
    updateEmail,
    updatePassword,
    reauthenticateWithCredential,
    EmailAuthProvider
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';

// Store current user globally for profile updates
let currentUserData = null;

/**
 * Initialize page authentication
 * Call this at the start of each protected page
 * @param {string} currentPage - The current page name for notification tracking (e.g., 'products', 'inbound', 'outbound')
 */
export async function initPageAuth(currentPage = null) {
    const loginPath = getLoginPath();
    try {
        const user = await requireAuth(loginPath);

        if (user) {
            currentUserData = user;
            updateUserDisplay(user);
            addAdminLinkIfAdmin(user);
            setupLogoutButton();
            setupProfileModal(user);

            // Load and display notification counts
            await loadNotificationCounts(user);

            // Mark current page as viewed if specified
            if (currentPage) {
                await markPageAsViewed(user.uid, currentPage);
            }
        }

        return user;
    } catch (error) {
        console.error('Page auth error:', error);
        window.location.href = loginPath;
        return null;
    }
}

/**
 * Update user display in sidebar footer
 */
function updateUserDisplay(user) {
    const avatar = document.getElementById('userAvatar');
    const name = document.getElementById('userName');
    const role = document.getElementById('userRole');

    if (avatar) {
        avatar.textContent = user.displayName ? user.displayName.charAt(0).toUpperCase() : 'U';
    }
    if (name) {
        name.textContent = user.displayName || 'User';
    }
    if (role) {
        role.textContent = user.role === 'admin' ? 'Administrator' : 'Staff';
    }
}

/**
 * Add admin link to sidebar if user is admin
 */
function addAdminLinkIfAdmin(user) {
    if (user.role !== 'admin') return;

    // Check if admin section already exists
    if (document.querySelector('.nav-section-admin')) return;

    const sidebarNav = document.querySelector('.sidebar-nav');
    if (!sidebarNav) return;

    // Create admin section
    const adminSection = document.createElement('div');
    adminSection.className = 'nav-section nav-section-admin';
    adminSection.innerHTML = `
        <div class="nav-section-title">Administration</div>
        <a href="../pages/admin-users.html" class="nav-item ${isCurrentPage('admin-users.html') ? 'active' : ''}">
            <span class="nav-item-icon">👥</span>
            <span>User Management</span>
        </a>
    `;

    sidebarNav.appendChild(adminSection);
}

/**
 * Check if current page matches filename
 */
function isCurrentPage(filename) {
    return window.location.pathname.includes(filename);
}

/**
 * Setup logout button
 */
function setupLogoutButton() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }
}

/**
 * Handle logout
 */
export async function handleLogout() {
    const result = await logout();
    if (result.success) {
        window.location.href = getLoginPath();
    } else {
        alert('Logout failed: ' + result.error);
    }
}

function getLoginPath() {
    return window.location.pathname.includes('/pages/')
        ? '../pages/login.html'
        : './pages/login.html';
}

/**
 * Load notification counts for all pages
 */
async function loadNotificationCounts(user) {
    try {
        // Get user's page view timestamps
        const userViewsRef = doc(db, 'userPageViews', user.uid);
        const userViewsDoc = await getDoc(userViewsRef);
        const lastViews = userViewsDoc.exists() ? userViewsDoc.data() : {};

        // Get counts for each page
        const [productsCount, inboundCount, outboundCount] = await Promise.all([
            getNewItemsCount('products', 'createdAt', lastViews.products),
            getNewItemsCount('inbound', 'createdAt', lastViews.inbound),
            getNewItemsCount('outbound', 'createdAt', lastViews.outbound)
        ]);

        // Update sidebar badges
        updateBadge('products-badge', productsCount);
        updateBadge('inbound-badge', inboundCount);
        updateBadge('outbound-badge', outboundCount);

    } catch (error) {
        console.error('Error loading notification counts:', error);
    }
}

/**
 * Get count of new items since last view
 */
async function getNewItemsCount(collectionName, dateField, lastViewedTimestamp) {
    try {
        // If user has never viewed this page, show 0 notifications (not all items)
        // This prevents new users from seeing thousands of "new" notifications
        if (!lastViewedTimestamp) {
            return 0;
        }

        const collectionRef = collection(db, collectionName);
        const q = query(collectionRef, where(dateField, '>', lastViewedTimestamp));
        const querySnapshot = await getDocs(q);

        return querySnapshot.size;
    } catch (error) {
        console.error(`Error getting count for ${collectionName}:`, error);
        return 0;
    }
}

/**
 * Update a badge element
 */
function updateBadge(badgeId, count) {
    const badge = document.getElementById(badgeId);
    if (badge) {
        if (count > 0) {
            badge.textContent = count > 99 ? '99+' : count;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    }
}

/**
 * Mark a page as viewed by the user
 */
async function markPageAsViewed(userId, pageName) {
    try {
        const userViewsRef = doc(db, 'userPageViews', userId);
        const userViewsDoc = await getDoc(userViewsRef);
        const currentData = userViewsDoc.exists() ? userViewsDoc.data() : {};

        // Update the timestamp for this page
        await setDoc(userViewsRef, {
            ...currentData,
            [pageName]: serverTimestamp()
        }, { merge: true });

        // Hide the badge for this page since user just viewed it
        updateBadge(`${pageName}-badge`, 0);

    } catch (error) {
        console.error('Error marking page as viewed:', error);
    }
}

/**
 * Refresh notification counts (can be called after adding new items)
 */
export async function refreshNotifications(user) {
    if (user) {
        await loadNotificationCounts(user);
    }
}

/**
 * Get IDs of new items since last view (for highlighting)
 * @param {string} userId - The user's ID
 * @param {string} collectionName - The collection to check
 * @returns {Promise<Set<string>>} Set of document IDs that are new
 */
export async function getNewItemIds(userId, collectionName) {
    try {
        // Get user's last view timestamp for this page
        const userViewsRef = doc(db, 'userPageViews', userId);
        const userViewsDoc = await getDoc(userViewsRef);
        const lastViews = userViewsDoc.exists() ? userViewsDoc.data() : {};
        const lastViewedTimestamp = lastViews[collectionName];

        // If user has never viewed this page, nothing is "new"
        if (!lastViewedTimestamp) {
            return new Set();
        }

        const collectionRef = collection(db, collectionName);
        const q = query(collectionRef, where('createdAt', '>', lastViewedTimestamp));
        const querySnapshot = await getDocs(q);

        const newIds = new Set();
        querySnapshot.forEach((doc) => {
            newIds.add(doc.id);
        });

        return newIds;
    } catch (error) {
        console.error(`Error getting new item IDs for ${collectionName}:`, error);
        return new Set();
    }
}

/**
 * Setup profile modal and make user name clickable
 */
function setupProfileModal(user) {
    // Create modal HTML if it doesn't exist
    if (!document.getElementById('profileModal')) {
        const modalHtml = `
            <div class="modal-overlay" id="profileModal" style="display: none;">
                <div class="modal" style="max-width: 480px;">
                    <div class="modal-header">
                        <h3 class="modal-title">Edit Profile</h3>
                        <button class="modal-close" onclick="window.closeProfileModal()">&times;</button>
                    </div>
                    <div class="modal-body">
                        <div id="profileError" class="alert alert-error" style="display: none; margin-bottom: 16px;">
                            <span class="alert-icon">!</span>
                            <div class="alert-content">
                                <div class="alert-text" id="profileErrorText"></div>
                            </div>
                        </div>
                        <div id="profileSuccess" class="alert alert-success" style="display: none; margin-bottom: 16px;">
                            <span class="alert-icon">&#10003;</span>
                            <div class="alert-content">
                                <div class="alert-text" id="profileSuccessText">Profile updated successfully!</div>
                            </div>
                        </div>
                        <form id="profileForm">
                            <div class="form-group">
                                <label class="form-label">Username</label>
                                <input type="text" class="form-control" id="profileUsername" disabled
                                       style="background: var(--gray-100); cursor: not-allowed;">
                                <small style="color: var(--gray-500); font-size: 0.75rem;">Username cannot be changed</small>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Display Name</label>
                                <input type="text" class="form-control" id="profileDisplayName" placeholder="Your display name" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Email</label>
                                <input type="email" class="form-control" id="profileEmail" placeholder="your@email.com" required>
                            </div>
                            <div style="border-top: 1px solid var(--gray-200); margin: 20px 0; padding-top: 20px;">
                                <p style="font-size: 0.875rem; color: var(--gray-600); margin-bottom: 16px;">Change Password (leave blank to keep current)</p>
                                <div class="form-group">
                                    <label class="form-label">Current Password</label>
                                    <input type="password" class="form-control" id="profileCurrentPassword" placeholder="Enter current password">
                                    <small style="color: var(--gray-500); font-size: 0.75rem;">Required to change email or password</small>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">New Password</label>
                                    <input type="password" class="form-control" id="profileNewPassword" placeholder="Enter new password" minlength="6">
                                </div>
                                <div class="form-group">
                                    <label class="form-label">Confirm New Password</label>
                                    <input type="password" class="form-control" id="profileConfirmPassword" placeholder="Confirm new password">
                                </div>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button type="button" class="btn btn-secondary" onclick="window.closeProfileModal()">Cancel</button>
                        <button type="button" class="btn btn-primary" id="profileSaveBtn" onclick="window.saveProfile()">Save Changes</button>
                    </div>
                </div>
            </div>
        `;
        document.body.insertAdjacentHTML('beforeend', modalHtml);

        // Close modal when clicking outside
        document.getElementById('profileModal').addEventListener('click', function(e) {
            if (e.target === this) {
                window.closeProfileModal();
            }
        });
    }

    // Make user info clickable
    const userProfile = document.querySelector('.user-profile');
    if (userProfile) {
        // Make the user info section (avatar + name + role) clickable, but not the logout button
        const userAvatar = document.getElementById('userAvatar');
        const userInfo = document.querySelector('.user-info');

        if (userAvatar) {
            userAvatar.style.cursor = 'pointer';
            userAvatar.title = 'Edit Profile';
            userAvatar.addEventListener('click', () => window.openProfileModal());
        }
        if (userInfo) {
            userInfo.style.cursor = 'pointer';
            userInfo.title = 'Edit Profile';
            userInfo.addEventListener('click', () => window.openProfileModal());
        }
    }

    // Setup global functions
    window.openProfileModal = function() {
        const modal = document.getElementById('profileModal');
        const error = document.getElementById('profileError');
        const success = document.getElementById('profileSuccess');

        // Populate form with current data
        document.getElementById('profileUsername').value = currentUserData.username || '';
        document.getElementById('profileDisplayName').value = currentUserData.displayName || '';
        document.getElementById('profileEmail').value = currentUserData.email || '';
        document.getElementById('profileCurrentPassword').value = '';
        document.getElementById('profileNewPassword').value = '';
        document.getElementById('profileConfirmPassword').value = '';

        error.style.display = 'none';
        success.style.display = 'none';
        modal.style.display = 'flex';
    };

    window.closeProfileModal = function() {
        document.getElementById('profileModal').style.display = 'none';
    };

    window.saveProfile = async function() {
        const saveBtn = document.getElementById('profileSaveBtn');
        const error = document.getElementById('profileError');
        const errorText = document.getElementById('profileErrorText');
        const success = document.getElementById('profileSuccess');
        const successText = document.getElementById('profileSuccessText');

        const displayName = document.getElementById('profileDisplayName').value.trim();
        const email = document.getElementById('profileEmail').value.trim();
        const currentPassword = document.getElementById('profileCurrentPassword').value;
        const newPassword = document.getElementById('profileNewPassword').value;
        const confirmPassword = document.getElementById('profileConfirmPassword').value;

        // Validation
        if (!displayName) {
            errorText.textContent = 'Display name is required';
            error.style.display = 'flex';
            return;
        }

        if (!email) {
            errorText.textContent = 'Email is required';
            error.style.display = 'flex';
            return;
        }

        // Check if email or password is being changed
        const emailChanged = email.toLowerCase() !== currentUserData.email.toLowerCase();
        const passwordChanged = newPassword.length > 0;

        if ((emailChanged || passwordChanged) && !currentPassword) {
            errorText.textContent = 'Current password is required to change email or password';
            error.style.display = 'flex';
            return;
        }

        if (passwordChanged && newPassword !== confirmPassword) {
            errorText.textContent = 'New passwords do not match';
            error.style.display = 'flex';
            return;
        }

        if (passwordChanged && newPassword.length < 6) {
            errorText.textContent = 'New password must be at least 6 characters';
            error.style.display = 'flex';
            return;
        }

        // Disable button
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        error.style.display = 'none';
        success.style.display = 'none';

        try {
            const user = auth.currentUser;

            // Re-authenticate if changing email or password
            if (emailChanged || passwordChanged) {
                const credential = EmailAuthProvider.credential(currentUserData.email, currentPassword);
                await reauthenticateWithCredential(user, credential);
            }

            // Update email in Firebase Auth if changed
            if (emailChanged) {
                await updateEmail(user, email);
            }

            // Update password in Firebase Auth if changed
            if (passwordChanged) {
                await updatePassword(user, newPassword);
            }

            // Update Firestore document
            await updateDoc(doc(db, 'users', currentUserData.uid), {
                displayName: displayName,
                email: email.toLowerCase()
            });

            // Update local user data
            currentUserData.displayName = displayName;
            currentUserData.email = email.toLowerCase();

            // Update UI
            updateUserDisplay(currentUserData);

            // Show success
            successText.textContent = 'Profile updated successfully!';
            success.style.display = 'flex';

            // Reset password fields
            document.getElementById('profileCurrentPassword').value = '';
            document.getElementById('profileNewPassword').value = '';
            document.getElementById('profileConfirmPassword').value = '';

            // Close modal after delay
            setTimeout(() => {
                window.closeProfileModal();
            }, 1500);

        } catch (err) {
            console.error('Profile update error:', err);
            let message = 'Failed to update profile';
            if (err.code === 'auth/wrong-password') {
                message = 'Current password is incorrect';
            } else if (err.code === 'auth/email-already-in-use') {
                message = 'Email is already in use by another account';
            } else if (err.code === 'auth/invalid-email') {
                message = 'Invalid email address';
            } else if (err.code === 'auth/requires-recent-login') {
                message = 'Please log out and log back in to change your email or password';
            }
            errorText.textContent = message;
            error.style.display = 'flex';
        } finally {
            saveBtn.disabled = false;
            saveBtn.textContent = 'Save Changes';
        }
    };
}

// Export for use in pages
export { updateUserDisplay, addAdminLinkIfAdmin, markPageAsViewed };
