import { auth, db } from './firebase-config.js';
import {
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    createUserWithEmailAndPassword
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-auth.js';
import {
    doc,
    setDoc,
    getDoc,
    getDocs,
    collection,
    query,
    where,
    serverTimestamp,
    deleteDoc
} from 'https://www.gstatic.com/firebasejs/12.8.0/firebase-firestore.js';

// ============================================
// USER DATA STRUCTURE IN FIRESTORE
// ============================================
// Collection: "users"
// Document ID: Firebase Auth UID
// Fields:
//   - username: string (unique)
//   - email: string
//   - role: "admin" | "staff"
//   - displayName: string
//   - createdAt: timestamp
//   - createdBy: string (admin's uid who created this user)

// ============================================
// AUTHENTICATION FUNCTIONS
// ============================================

/**
 * Login with username and password
 * Steps:
 * 1. Look up email by username in Firestore
 * 2. Authenticate with Firebase using email + password
 */
export async function loginWithUsername(username, password) {
    try {
        // Step 1: Find user by username
        const usersRef = collection(db, 'users');
        const q = query(usersRef, where('username', '==', username.toLowerCase()));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            throw new Error('Invalid username or password');
        }

        // Get the email from the user document
        const userDoc = querySnapshot.docs[0];
        const userData = userDoc.data();
        const email = userData.email;

        // Step 2: Authenticate with Firebase Auth
        const userCredential = await signInWithEmailAndPassword(auth, email, password);

        return {
            success: true,
            user: {
                uid: userCredential.user.uid,
                email: email,
                username: userData.username,
                displayName: userData.displayName,
                role: userData.role
            }
        };
    } catch (error) {
        console.error('Login error:', error);
        let message = 'Invalid username or password';
        if (error.code === 'auth/too-many-requests') {
            message = 'Too many failed attempts. Please try again later.';
        }
        return {
            success: false,
            error: message
        };
    }
}

/**
 * Logout the current user
 */
export async function logout() {
    try {
        await signOut(auth);
        // Clear stored user data
        localStorage.removeItem('currentUser');
        sessionStorage.removeItem('currentUser');
        return { success: true };
    } catch (error) {
        console.error('Logout error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Get current user data from Firestore
 */
export async function getCurrentUserData() {
    const user = auth.currentUser;
    if (!user) return null;

    try {
        const userDoc = await getDoc(doc(db, 'users', user.uid));
        if (userDoc.exists()) {
            return {
                uid: user.uid,
                ...userDoc.data()
            };
        }
        return null;
    } catch (error) {
        console.error('Error getting user data:', error);
        return null;
    }
}

/**
 * Check if a username is already taken
 */
export async function isUsernameTaken(username) {
    const usersRef = collection(db, 'users');
    const q = query(usersRef, where('username', '==', username.toLowerCase()));
    const querySnapshot = await getDocs(q);
    return !querySnapshot.empty;
}

// ============================================
// ADMIN FUNCTIONS - CREATE/MANAGE USERS
// ============================================

/**
 * Create a new user (Admin only)
 * Creates Firebase Auth user and stores user data in Firestore
 */
export async function createUser(username, email, password, role, displayName) {
    try {
        // Validate inputs
        if (!username || !email || !password || !role || !displayName) {
            throw new Error('All fields are required');
        }

        // Check if username is taken
        const usernameTaken = await isUsernameTaken(username);
        if (usernameTaken) {
            throw new Error('Username is already taken');
        }

        // Get current admin user
        const adminUser = auth.currentUser;
        if (!adminUser) {
            throw new Error('You must be logged in as admin to create users');
        }

        // Verify admin role
        const adminData = await getCurrentUserData();
        if (!adminData || adminData.role !== 'admin') {
            throw new Error('Only admins can create new users');
        }

        // Store current admin credentials temporarily
        // We need to re-authenticate as admin after creating the new user
        // because createUserWithEmailAndPassword signs in as the new user

        // Create Firebase Auth user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;

        // Store user data in Firestore
        await setDoc(doc(db, 'users', newUser.uid), {
            username: username.toLowerCase(),
            email: email.toLowerCase(),
            role: role,
            displayName: displayName,
            createdAt: serverTimestamp(),
            createdBy: adminUser.uid
        });

        // Note: After creating a user, Firebase automatically signs in as that user
        // The calling code should handle re-authenticating as admin

        return {
            success: true,
            user: {
                uid: newUser.uid,
                username: username.toLowerCase(),
                email: email.toLowerCase(),
                role: role,
                displayName: displayName
            }
        };
    } catch (error) {
        console.error('Create user error:', error);
        let message = error.message;
        if (error.code === 'auth/email-already-in-use') {
            message = 'Email is already in use';
        } else if (error.code === 'auth/invalid-email') {
            message = 'Invalid email address';
        } else if (error.code === 'auth/weak-password') {
            message = 'Password should be at least 6 characters';
        }
        return {
            success: false,
            error: message
        };
    }
}

/**
 * Get all users (Admin only)
 */
export async function getAllUsers() {
    try {
        const adminData = await getCurrentUserData();
        if (!adminData || adminData.role !== 'admin') {
            throw new Error('Only admins can view all users');
        }

        const usersRef = collection(db, 'users');
        const querySnapshot = await getDocs(usersRef);

        const users = [];
        querySnapshot.forEach((doc) => {
            users.push({
                uid: doc.id,
                ...doc.data()
            });
        });

        return { success: true, users };
    } catch (error) {
        console.error('Get users error:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Delete a user (Admin only)
 * Note: This only removes the Firestore document
 * The Firebase Auth user deletion requires Admin SDK (backend)
 */
export async function deleteUserData(uid) {
    try {
        const adminData = await getCurrentUserData();
        if (!adminData || adminData.role !== 'admin') {
            throw new Error('Only admins can delete users');
        }

        // Don't allow deleting yourself
        if (uid === auth.currentUser.uid) {
            throw new Error('You cannot delete your own account');
        }

        await deleteDoc(doc(db, 'users', uid));

        return { success: true };
    } catch (error) {
        console.error('Delete user error:', error);
        return { success: false, error: error.message };
    }
}

// ============================================
// AUTH STATE & GUARDS
// ============================================

/**
 * Listen to auth state changes
 */
export function onAuthChange(callback) {
    return onAuthStateChanged(auth, async (user) => {
        if (user) {
            const userData = await getCurrentUserData();
            callback(userData);
        } else {
            callback(null);
        }
    });
}

/**
 * Check if user is authenticated
 * Redirects to login if not authenticated
 */
export function requireAuth(redirectUrl = '../pages/login.html') {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            unsubscribe(); // Stop listening after first check
            if (user) {
                const userData = await getCurrentUserData();
                if (userData) {
                    resolve(userData);
                } else {
                    window.location.href = redirectUrl;
                }
            } else {
                window.location.href = redirectUrl;
            }
        });
    });
}

/**
 * Check if user is admin
 * Redirects to dashboard if not admin
 */
export function requireAdmin(redirectUrl = 'index.html') {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            unsubscribe();
            if (user) {
                const userData = await getCurrentUserData();
                if (userData && userData.role === 'admin') {
                    resolve(userData);
                } else {
                    window.location.href = redirectUrl;
                }
            } else {
                window.location.href = '../pages/login.html';
            }
        });
    });
}

/**
 * Redirect to dashboard if already logged in
 * Use this on login page
 */
export function redirectIfAuthenticated(redirectUrl = 'index.html') {
    return new Promise((resolve) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            if (user) {
                window.location.href = redirectUrl;
            } else {
                resolve();
            }
        });
    });
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Store user data in local/session storage
 */
export function storeUserLocally(userData, remember = false) {
    const storage = remember ? localStorage : sessionStorage;
    storage.setItem('currentUser', JSON.stringify(userData));
}

/**
 * Get stored user data
 */
export function getStoredUser() {
    const localUser = localStorage.getItem('currentUser');
    const sessionUser = sessionStorage.getItem('currentUser');

    if (localUser) {
        return JSON.parse(localUser);
    }
    if (sessionUser) {
        return JSON.parse(sessionUser);
    }
    return null;
}

/**
 * Initialize first admin user (run once for setup)
 * This function should be called once to create the initial admin
 */
export async function initializeFirstAdmin(username, email, password, displayName) {
    try {
        // Check if any users exist
        const usersRef = collection(db, 'users');
        const querySnapshot = await getDocs(usersRef);

        if (!querySnapshot.empty) {
            throw new Error('Users already exist. Cannot initialize first admin.');
        }

        // Create Firebase Auth user
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const newUser = userCredential.user;

        // Store admin data in Firestore
        await setDoc(doc(db, 'users', newUser.uid), {
            username: username.toLowerCase(),
            email: email.toLowerCase(),
            role: 'admin',
            displayName: displayName,
            createdAt: serverTimestamp(),
            createdBy: 'system'
        });

        return {
            success: true,
            message: 'First admin created successfully'
        };
    } catch (error) {
        console.error('Initialize admin error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

// Export auth for direct access if needed
export { auth, db };
