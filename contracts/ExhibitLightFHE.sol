// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ExhibitLightFHE is SepoliaConfig {
    struct EncryptedPreference {
        uint256 exhibitId;
        euint32 encryptedBrightness; // Encrypted brightness preference
        euint32 encryptedColorTemp;  // Encrypted color temperature preference
        euint32 encryptedVision;     // Encrypted vision condition
        uint256 timestamp;
    }
    
    struct LightSetting {
        uint32 brightness;
        uint32 colorTemp;
        bool isRevealed;
    }

    uint256 public preferenceCount;
    mapping(uint256 => EncryptedPreference) public encryptedPreferences;
    mapping(uint256 => LightSetting) public lightSettings;
    mapping(uint256 => uint256) private requestToPreferenceId;
    
    event PreferenceSubmitted(uint256 indexed id, uint256 exhibitId, uint256 timestamp);
    event DecryptionRequested(uint256 indexed id);
    event LightSettingRevealed(uint256 indexed id);

    modifier onlySubmitter(uint256 preferenceId) {
        // Access control logic would be implemented here
        _;
    }

    /// @notice Submit encrypted lighting preferences
    function submitEncryptedPreference(
        uint256 exhibitId,
        euint32 encryptedBrightness,
        euint32 encryptedColorTemp,
        euint32 encryptedVision
    ) public {
        preferenceCount += 1;
        uint256 newId = preferenceCount;
        
        encryptedPreferences[newId] = EncryptedPreference({
            exhibitId: exhibitId,
            encryptedBrightness: encryptedBrightness,
            encryptedColorTemp: encryptedColorTemp,
            encryptedVision: encryptedVision,
            timestamp: block.timestamp
        });
        
        lightSettings[newId] = LightSetting({
            brightness: 0,
            colorTemp: 0,
            isRevealed: false
        });
        
        emit PreferenceSubmitted(newId, exhibitId, block.timestamp);
    }

    /// @notice Calculate optimal lighting settings
    function calculateLightSettings(uint256 preferenceId) public {
        EncryptedPreference storage pref = encryptedPreferences[preferenceId];
        require(!lightSettings[preferenceId].isRevealed, "Already calculated");
        
        // Calculate optimal brightness (vision-adjusted)
        euint32 adjustedBrightness = FHE.add(
            pref.encryptedBrightness, 
            FHE.mul(pref.encryptedVision, FHE.asEuint32(10))
        );
        
        // Prepare encrypted data for decryption
        bytes32[] memory ciphertexts = new bytes32[](2);
        ciphertexts[0] = FHE.toBytes32(adjustedBrightness);
        ciphertexts[1] = FHE.toBytes32(pref.encryptedColorTemp);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.setLightSettings.selector);
        requestToPreferenceId[reqId] = preferenceId;
        
        emit DecryptionRequested(preferenceId);
    }

    /// @notice Set decrypted light settings
    function setLightSettings(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 preferenceId = requestToPreferenceId[requestId];
        require(preferenceId != 0, "Invalid request");
        
        LightSetting storage setting = lightSettings[preferenceId];
        require(!setting.isRevealed, "Already set");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32[] memory results = abi.decode(cleartexts, (uint32[]));
        
        setting.brightness = results[0];
        setting.colorTemp = results[1];
        setting.isRevealed = true;
        
        emit LightSettingRevealed(preferenceId);
    }

    /// @notice Get light settings
    function getLightSettings(uint256 preferenceId) public view returns (
        uint32 brightness,
        uint32 colorTemp,
        bool isRevealed
    ) {
        LightSetting storage s = lightSettings[preferenceId];
        return (s.brightness, s.colorTemp, s.isRevealed);
    }
}