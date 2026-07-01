import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import "../App.css";
import "../css/Login.css";
import { verifyUser } from "../api/users";

type Status = "idle" | "verifying" | "success" | "error";

function VerifyEmail() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token");

    const [status, setStatus] = useState<Status>("idle");
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!token) return;

        async function verify() {
            setStatus('verifying');

            try {
                if (!token) throw new Error('No token provided');
                await verifyUser(token);
                setStatus('success');
            } catch (err) {
                setError(
                    err instanceof Error
                        ? err.message
                        : 'Something went wrong. Please try again.'
                );
                setStatus('error');
            }
        }

        verify();
    }, [token]);

    return (
        <div className="auth-page">
            <nav className="auth-nav">
                <Link to="/" className="auth-nav__logo">
                    <span className="auth-nav__logo-mark" aria-hidden="true" />
                    SkysyncR
                </Link>
            </nav>

            <main className="auth" style={{ gridTemplateColumns: "1fr" }}>
                <section
                    className="auth__form-wrap"
                    style={{ justifyContent: "center" }}
                >
                    <div
                        className="auth__form-card"
                        style={{ textAlign: "center" }}
                    >
                        {status === "verifying" && (
                            <>
                                <h1 className="auth__title">Verifying your email…</h1>
                                <p className="auth__subtitle">Just a moment.</p>
                            </>
                        )}

                        {status === "success" && (
                            <>
                                <h1 className="auth__title">Email verified</h1>
                                <p className="auth__subtitle">
                                    Your email has been successfully verified.
                                </p>

                                <Link
                                    to="/login"
                                    className="btn btn--solid btn--lg"
                                    style={{
                                        width: "100%",
                                        display: "block",
                                        textAlign: "center",
                                    }}
                                >
                                    Sign in
                                </Link>
                            </>
                        )}

                        {status === "error" && (
                            <>
                                <h1 className="auth__title">Verification failed</h1>
                                <p className="auth__subtitle">{error}</p>

                                <Link
                                    to="/login"
                                    className="btn btn--outline btn--lg"
                                    style={{
                                        width: "100%",
                                        display: "block",
                                        textAlign: "center",
                                    }}
                                >
                                    Back to sign in
                                </Link>
                            </>
                        )}
                    </div>
                </section>
            </main>
        </div>
    );
}

export default VerifyEmail;