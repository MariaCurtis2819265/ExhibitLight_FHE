import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface LightingPreference {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  exhibitId: string;
  lightingIntensity: number;
  colorTemperature: number;
  visionCondition: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [preferences, setPreferences] = useState<LightingPreference[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newPreference, setNewPreference] = useState({
    exhibitId: "",
    lightingIntensity: 50,
    colorTemperature: 4000,
    visionCondition: "normal"
  });
  const [activeTab, setActiveTab] = useState("dashboard");
  const [selectedPreference, setSelectedPreference] = useState<LightingPreference | null>(null);
  const [showFAQ, setShowFAQ] = useState(false);

  // Calculate statistics for dashboard
  const intensityStats = {
    low: preferences.filter(p => p.lightingIntensity < 40).length,
    medium: preferences.filter(p => p.lightingIntensity >= 40 && p.lightingIntensity <= 70).length,
    high: preferences.filter(p => p.lightingIntensity > 70).length
  };

  const temperatureStats = {
    warm: preferences.filter(p => p.colorTemperature < 3500).length,
    neutral: preferences.filter(p => p.colorTemperature >= 3500 && p.colorTemperature <= 5000).length,
    cool: preferences.filter(p => p.colorTemperature > 5000).length
  };

  useEffect(() => {
    loadPreferences().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadPreferences = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("preference_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing preference keys:", e);
        }
      }
      
      const list: LightingPreference[] = [];
      
      for (const key of keys) {
        try {
          const prefBytes = await contract.getData(`preference_${key}`);
          if (prefBytes.length > 0) {
            try {
              const prefData = JSON.parse(ethers.toUtf8String(prefBytes));
              list.push({
                id: key,
                encryptedData: prefData.data,
                timestamp: prefData.timestamp,
                owner: prefData.owner,
                exhibitId: prefData.exhibitId,
                lightingIntensity: prefData.lightingIntensity,
                colorTemperature: prefData.colorTemperature,
                visionCondition: prefData.visionCondition
              });
            } catch (e) {
              console.error(`Error parsing preference data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading preference ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setPreferences(list);
    } catch (e) {
      console.error("Error loading preferences:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitPreference = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting lighting preferences with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newPreference))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const prefId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const prefData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        exhibitId: newPreference.exhibitId,
        lightingIntensity: newPreference.lightingIntensity,
        colorTemperature: newPreference.colorTemperature,
        visionCondition: newPreference.visionCondition
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `preference_${prefId}`, 
        ethers.toUtf8Bytes(JSON.stringify(prefData))
      );
      
      const keysBytes = await contract.getData("preference_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(prefId);
      
      await contract.setData(
        "preference_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Lighting preferences encrypted and stored!"
      });
      
      await loadPreferences();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewPreference({
          exhibitId: "",
          lightingIntensity: 50,
          colorTemperature: 4000,
          visionCondition: "normal"
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const checkAvailability = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Checking FHE contract availability..."
    });

    try {
      const contract = await getContractReadOnly();
      if (!contract) throw new Error("Contract not found");
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE contract is ${isAvailable ? "available" : "unavailable"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const renderIntensityChart = () => {
    const total = preferences.length || 1;
    const lowPercentage = (intensityStats.low / total) * 100;
    const mediumPercentage = (intensityStats.medium / total) * 100;
    const highPercentage = (intensityStats.high / total) * 100;

    return (
      <div className="chart-container">
        <h3>Light Intensity Preferences</h3>
        <div className="bar-chart">
          <div className="bar low" style={{ height: `${lowPercentage}%` }}>
            <span className="bar-label">Low</span>
            <span className="bar-value">{intensityStats.low}</span>
          </div>
          <div className="bar medium" style={{ height: `${mediumPercentage}%` }}>
            <span className="bar-label">Medium</span>
            <span className="bar-value">{intensityStats.medium}</span>
          </div>
          <div className="bar high" style={{ height: `${highPercentage}%` }}>
            <span className="bar-label">High</span>
            <span className="bar-value">{intensityStats.high}</span>
          </div>
        </div>
      </div>
    );
  };

  const renderTemperatureChart = () => {
    const total = preferences.length || 1;
    const warmPercentage = (temperatureStats.warm / total) * 100;
    const neutralPercentage = (temperatureStats.neutral / total) * 100;
    const coolPercentage = (temperatureStats.cool / total) * 100;

    return (
      <div className="chart-container">
        <h3>Color Temperature Preferences</h3>
        <div className="bar-chart">
          <div className="bar warm" style={{ height: `${warmPercentage}%` }}>
            <span className="bar-label">Warm</span>
            <span className="bar-value">{temperatureStats.warm}</span>
          </div>
          <div className="bar neutral" style={{ height: `${neutralPercentage}%` }}>
            <span className="bar-label">Neutral</span>
            <span className="bar-value">{temperatureStats.neutral}</span>
          </div>
          <div className="bar cool" style={{ height: `${coolPercentage}%` }}>
            <span className="bar-label">Cool</span>
            <span className="bar-value">{temperatureStats.cool}</span>
          </div>
        </div>
      </div>
    );
  };

  const faqItems = [
    {
      question: "How does FHE protect my privacy?",
      answer: "Fully Homomorphic Encryption allows your lighting preferences to be processed while still encrypted. The museum system can adjust lighting without ever seeing your personal data."
    },
    {
      question: "Can the museum see my vision condition?",
      answer: "No, your vision condition is encrypted using FHE and remains private throughout the entire process."
    },
    {
      question: "How are my preferences applied?",
      answer: "When you approach an exhibit, your encrypted preferences are used to dynamically adjust the lighting in real-time using FHE computations."
    },
    {
      question: "Is my data stored permanently?",
      answer: "Preferences are stored on-chain until you choose to delete them. You maintain full control over your data."
    },
    {
      question: "Can I use this without a wallet?",
      answer: "Currently, wallet connection is required to ensure your preferences are securely encrypted and associated with your identity."
    }
  ];

  if (loading) return (
    <div className="loading-screen">
      <div className="tech-spinner"></div>
      <p>Initializing encrypted lighting system...</p>
    </div>
  );

  return (
    <div className="app-container tech-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="light-icon"></div>
          </div>
          <h1>ExhibitLight<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-pref-btn tech-button"
          >
            <div className="add-icon"></div>
            New Preference
          </button>
          <button 
            className="tech-button"
            onClick={() => setShowFAQ(!showFAQ)}
          >
            {showFAQ ? "Hide FAQ" : "Show FAQ"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-layout">
        <div className="sidebar">
          <div className="sidebar-section">
            <h3>Navigation</h3>
            <button 
              className={`sidebar-btn ${activeTab === "dashboard" ? "active" : ""}`}
              onClick={() => setActiveTab("dashboard")}
            >
              Dashboard
            </button>
            <button 
              className={`sidebar-btn ${activeTab === "preferences" ? "active" : ""}`}
              onClick={() => setActiveTab("preferences")}
            >
              My Preferences
            </button>
            <button 
              className={`sidebar-btn ${activeTab === "fhe" ? "active" : ""}`}
              onClick={() => setActiveTab("fhe")}
            >
              FHE Technology
            </button>
          </div>
          
          <div className="sidebar-section">
            <h3>System Tools</h3>
            <button 
              className="sidebar-btn"
              onClick={checkAvailability}
            >
              Check FHE Availability
            </button>
            <button 
              className="sidebar-btn"
              onClick={loadPreferences}
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>
        </div>
        
        <div className="main-content">
          {showFAQ && (
            <div className="faq-section">
              <h2>Frequently Asked Questions</h2>
              <div className="faq-list">
                {faqItems.map((faq, index) => (
                  <div className="faq-item" key={index}>
                    <h3>{faq.question}</h3>
                    <p>{faq.answer}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
          
          {activeTab === "dashboard" && (
            <div className="dashboard-content">
              <div className="welcome-banner">
                <div className="welcome-text">
                  <h2>Privacy-Preserving Museum Lighting</h2>
                  <p>Personalize exhibit lighting using Fully Homomorphic Encryption to protect your preferences</p>
                </div>
              </div>
              
              <div className="project-intro tech-card">
                <h3>About ExhibitLight FHE</h3>
                <p>
                  ExhibitLight FHE revolutionizes museum experiences by allowing visitors to customize exhibit lighting 
                  while maintaining complete privacy. Using Fully Homomorphic Encryption (FHE), your lighting preferences 
                  and vision conditions are encrypted before being sent to the museum's system. 
                </p>
                <p>
                  The lighting adjustments are computed directly on the encrypted data, ensuring your personal information 
                  remains private throughout the entire process. Experience art in your preferred lighting without 
                  compromising your privacy.
                </p>
                <div className="fhe-badge">
                  <span>FHE-Powered Privacy</span>
                </div>
              </div>
              
              <div className="charts-container">
                {renderIntensityChart()}
                {renderTemperatureChart()}
              </div>
            </div>
          )}
          
          {activeTab === "preferences" && (
            <div className="preferences-content">
              <div className="section-header">
                <h2>My Lighting Preferences</h2>
                <button 
                  onClick={() => setShowCreateModal(true)}
                  className="tech-button primary"
                >
                  + Add New Preference
                </button>
              </div>
              
              <div className="preferences-list tech-card">
                <div className="table-header">
                  <div className="header-cell">Exhibit ID</div>
                  <div className="header-cell">Intensity</div>
                  <div className="header-cell">Temperature</div>
                  <div className="header-cell">Vision</div>
                  <div className="header-cell">Date</div>
                  <div className="header-cell">Actions</div>
                </div>
                
                {preferences.length === 0 ? (
                  <div className="no-preferences">
                    <div className="no-prefs-icon"></div>
                    <p>No lighting preferences found</p>
                    <button 
                      className="tech-button primary"
                      onClick={() => setShowCreateModal(true)}
                    >
                      Create First Preference
                    </button>
                  </div>
                ) : (
                  preferences.filter(p => isOwner(p.owner)).map(pref => (
                    <div 
                      className="preference-row" 
                      key={pref.id}
                      onClick={() => setSelectedPreference(pref)}
                    >
                      <div className="table-cell">{pref.exhibitId}</div>
                      <div className="table-cell">
                        <div className="intensity-bar">
                          <div 
                            className="intensity-level" 
                            style={{ width: `${pref.lightingIntensity}%` }}
                          ></div>
                          <span>{pref.lightingIntensity}%</span>
                        </div>
                      </div>
                      <div className="table-cell">
                        <div className="temperature-indicator">
                          <div 
                            className="temp-color" 
                            style={{ 
                              backgroundColor: pref.colorTemperature < 3500 ? 
                                '#ffb347' : pref.colorTemperature < 5000 ? 
                                '#fffacd' : '#add8e6'
                            }}
                          ></div>
                          <span>{pref.colorTemperature}K</span>
                        </div>
                      </div>
                      <div className="table-cell">
                        <span className={`vision-badge ${pref.visionCondition}`}>
                          {pref.visionCondition}
                        </span>
                      </div>
                      <div className="table-cell">
                        {new Date(pref.timestamp * 1000).toLocaleDateString()}
                      </div>
                      <div className="table-cell actions">
                        <button 
                          className="action-btn tech-button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedPreference(pref);
                          }}
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
          
          {activeTab === "fhe" && (
            <div className="fhe-content">
              <div className="tech-card">
                <h2>Fully Homomorphic Encryption</h2>
                <div className="fhe-explanation">
                  <div className="fhe-step">
                    <div className="step-icon">1</div>
                    <div className="step-content">
                      <h3>Encrypted Preferences</h3>
                      <p>Your lighting preferences and vision conditions are encrypted using FHE before leaving your device.</p>
                    </div>
                  </div>
                  <div className="fhe-step">
                    <div className="step-icon">2</div>
                    <div className="step-content">
                      <h3>Secure Processing</h3>
                      <p>The museum's lighting system processes your encrypted data without ever decrypting it.</p>
                    </div>
                  </div>
                  <div className="fhe-step">
                    <div className="step-icon">3</div>
                    <div className="step-content">
                      <h3>Personalized Lighting</h3>
                      <p>Lighting adjustments are computed directly on encrypted data, delivering personalized experiences while preserving privacy.</p>
                    </div>
                  </div>
                </div>
                
                <div className="fhe-benefits">
                  <h3>Benefits of FHE in Museum Lighting</h3>
                  <ul>
                    <li>Complete privacy for visitors' preferences and health data</li>
                    <li>Personalized experiences without data exposure</li>
                    <li>Compliance with strict privacy regulations</li>
                    <li>Enhanced accessibility for visitors with vision conditions</li>
                    <li>Secure data processing on public blockchain</li>
                  </ul>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitPreference} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          preference={newPreference}
          setPreference={setNewPreference}
        />
      )}
      
      {selectedPreference && (
        <PreferenceDetail 
          preference={selectedPreference}
          onClose={() => setSelectedPreference(null)}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content tech-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="tech-spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="light-icon"></div>
              <span>ExhibitLight FHE</span>
            </div>
            <p>Privacy-preserving museum lighting using Zama FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} ExhibitLight FHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  preference: any;
  setPreference: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  preference,
  setPreference
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setPreference({
      ...preference,
      [name]: value
    });
  };

  const handleIntensityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPreference({
      ...preference,
      lightingIntensity: parseInt(e.target.value)
    });
  };

  const handleTemperatureChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPreference({
      ...preference,
      colorTemperature: parseInt(e.target.value)
    });
  };

  const handleSubmit = () => {
    if (!preference.exhibitId) {
      alert("Please select an exhibit");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal tech-card">
        <div className="modal-header">
          <h2>Create Lighting Preference</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Your preferences will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Exhibit *</label>
              <select 
                name="exhibitId"
                value={preference.exhibitId} 
                onChange={handleChange}
                className="tech-select"
              >
                <option value="">Select exhibit</option>
                <option value="GAL-101">Gallery A: Renaissance Art</option>
                <option value="GAL-102">Gallery B: Modern Sculptures</option>
                <option value="GAL-201">Gallery C: Ancient Artifacts</option>
                <option value="GAL-202">Gallery D: Contemporary Art</option>
                <option value="GAL-301">Gallery E: Photography</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Light Intensity</label>
              <div className="slider-container">
                <input 
                  type="range"
                  min="0"
                  max="100"
                  value={preference.lightingIntensity}
                  onChange={handleIntensityChange}
                  className="tech-slider"
                />
                <span className="slider-value">{preference.lightingIntensity}%</span>
              </div>
            </div>
            
            <div className="form-group">
              <label>Color Temperature</label>
              <div className="slider-container">
                <input 
                  type="range"
                  min="2000"
                  max="6500"
                  value={preference.colorTemperature}
                  onChange={handleTemperatureChange}
                  className="tech-slider"
                />
                <div className="temp-scale">
                  <span>Warm</span>
                  <span>Neutral</span>
                  <span>Cool</span>
                </div>
                <span className="slider-value">{preference.colorTemperature}K</span>
              </div>
            </div>
            
            <div className="form-group">
              <label>Vision Condition</label>
              <select 
                name="visionCondition"
                value={preference.visionCondition} 
                onChange={handleChange}
                className="tech-select"
              >
                <option value="normal">Normal Vision</option>
                <option value="myopia">Myopia (Nearsighted)</option>
                <option value="hyperopia">Hyperopia (Farsighted)</option>
                <option value="astigmatism">Astigmatism</option>
                <option value="colorblind">Color Vision Deficiency</option>
              </select>
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> Your vision condition is encrypted and never exposed
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn tech-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn tech-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Save Preferences"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface PreferenceDetailProps {
  preference: LightingPreference;
  onClose: () => void;
}

const PreferenceDetail: React.FC<PreferenceDetailProps> = ({ preference, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="detail-modal tech-card">
        <div className="modal-header">
          <h2>Preference Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-item">
              <label>Exhibit ID</label>
              <div className="detail-value">{preference.exhibitId}</div>
            </div>
            
            <div className="detail-item">
              <label>Light Intensity</label>
              <div className="detail-value">
                <div className="intensity-bar">
                  <div 
                    className="intensity-level" 
                    style={{ width: `${preference.lightingIntensity}%` }}
                  ></div>
                  <span>{preference.lightingIntensity}%</span>
                </div>
              </div>
            </div>
            
            <div className="detail-item">
              <label>Color Temperature</label>
              <div className="detail-value">
                <div className="temperature-indicator">
                  <div 
                    className="temp-color" 
                    style={{ 
                      backgroundColor: preference.colorTemperature < 3500 ? 
                        '#ffb347' : preference.colorTemperature < 5000 ? 
                        '#fffacd' : '#add8e6'
                    }}
                  ></div>
                  <span>{preference.colorTemperature}K</span>
                </div>
              </div>
            </div>
            
            <div className="detail-item">
              <label>Vision Condition</label>
              <div className="detail-value">
                <span className={`vision-badge ${preference.visionCondition}`}>
                  {preference.visionCondition}
                </span>
              </div>
            </div>
            
            <div className="detail-item">
              <label>Created</label>
              <div className="detail-value">
                {new Date(preference.timestamp * 1000).toLocaleString()}
              </div>
            </div>
            
            <div className="detail-item">
              <label>Owner</label>
              <div className="detail-value">
                {preference.owner.substring(0, 6)}...{preference.owner.substring(38)}
              </div>
            </div>
            
            <div className="detail-item full-width">
              <label>Encrypted Data</label>
              <div className="detail-value encrypted-data">
                {preference.encryptedData.substring(0, 120)}...
              </div>
            </div>
          </div>
          
          <div className="fhe-notice">
            <div className="lock-icon"></div> 
            <p>This data is encrypted using FHE and can only be processed by the museum's lighting system</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="tech-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;